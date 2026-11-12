/**
 * .heist           — start a crew heist ($1M entry)
 * .heist join      — join the active heist ($1M entry)
 * .heist do <number> — answer your assigned heist task
 * .heist cancel    — cancel heist (starter only)
 * .heist status    — check who's joined
 */
import { getUser, saveUser, requireRegistration, addHistory, jailUser } from "./database.js";
import { hasActiveGun } from "../../lib/economySecurity.mjs";
import { economyWinRate } from "../../lib/economyOdds.mjs";
import {
  calculateHeistPayouts,
  createHeistTasks,
  HEIST_TASK_COUNT,
  MAX_HEIST_MEMBERS,
  MIN_HEIST_MEMBERS,
  getHeistAnswerOutcome,
} from "../../lib/heistTasks.mjs";

const JOIN_WINDOW    = 60 * 1000;  // 60 seconds to join
const TASK_TIMEOUT   = 30 * 1000;  // 30 seconds per crew action
const JAIL_DURATION  = 10 * 60 * 1000;
const ENTRY_FEE      = 1_000_000;
const MIN_MEMBERS    = MIN_HEIST_MEMBERS;

const activeHeists = new Map();    // jid → active recruiting or task state
const HEIST_ITEMS = ["hack_kit", "med_kit"];

function hasHeistItems(user) {
  const inventory = Array.isArray(user.inventory) ? user.inventory : [];
  return HEIST_ITEMS.every((item) => inventory.includes(item));
}

function consumeHeistItems(user) {
  const inventory = Array.isArray(user.inventory) ? [...user.inventory] : [];
  for (const item of HEIST_ITEMS) inventory.splice(inventory.indexOf(item), 1);
  user.inventory = inventory;
}

function refundHeistItems(user) {
  user.inventory = [...(Array.isArray(user.inventory) ? user.inventory : []), ...HEIST_ITEMS];
}

function fmt(n) {
  if (n >= 1e9) return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "heist",
  aliases: ["robgroup", "crew"],
  category: "economy",
  cooldown: 6,
  description: "Run a difficult seven-stage bank heist with a crew.",
  usage: ".heist | join | status | do <number> | cancel",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const sub   = (args[0] || "").toLowerCase();

    if (!jid.endsWith("@g.us")) return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *GROUP ONLY 🔴*
│
│ ⚠️ *Heist only works in group chats!*
╰───────────────❀`
    );

    // ── TASK ACTION ─────────────────────────────────────────────────────────────
    if (sub === "do" || sub === "act") {
      const heist = activeHeists.get(jid);
      if (!heist || heist.phase !== "tasks") return reply("❌ There is no heist task waiting for an answer.");
      if (heist.resolving) return reply("⏳ That task is being resolved. Wait for the next one.");

      const task = heist.tasks[heist.taskIndex];
      const actorId = task?.actorIds[heist.actorIndex];
      if (!actorId) return reply("❌ The heist task state is unavailable. Please start a new heist.");
      if (actorId !== sender) {
        return sock.sendMessage(jid, {
          text: `❌ It is @${actorId.split("@")[0].split(":")[0]}'s turn to answer.`,
          mentions: [actorId],
        }, { quoted: msg });
      }

      const answer = args[1];
      const answerNumber = Number(answer);
      if (!Number.isInteger(answerNumber) || answerNumber < 1 || answerNumber > task.options.length) {
        return reply(`Choose a listed option with \`.heist do <number>\` (1–${task.options.length}).`);
      }

      heist.resolving = true;
      clearTimeout(heist.taskTimeout);
      const outcome = getHeistAnswerOutcome(task, answerNumber);
      if (outcome === "fail") {
        return failHeist(sock, jid, heist, "A crew member chose the wrong action.", actorId);
      }

      if (outcome === "betray") {
        const betrayer = await getUser(actorId);
        if (Math.random() < economyWinRate(0.28, betrayer)) {
          return completeHeist(sock, jid, heist, { betrayerId: actorId });
        }
        return failHeist(sock, jid, heist, "The crew spotted the double-cross before the getaway.", actorId);
      }

      if (outcome === "abandon") {
        const target = heist.members.find((member) => member.id === task.targetId && !member.abandoned);
        if (!target || target.id === actorId) {
          return failHeist(sock, jid, heist, "The trapped crew member could not be reached.", actorId);
        }
        const results = await Promise.allSettled([
          jailUser(target.id, JAIL_DURATION),
          addHistory(target.id, "jail", 0, "Left behind during a heist; jailed for 10 minutes"),
        ]);
        if (results[0].status === "rejected") {
          return failHeist(sock, jid, heist, "The captured teammate's jail record could not be saved.", actorId);
        }
        target.abandoned = true;
        heist.lootPenalty = (heist.lootPenalty || 0) + 2_000_000;
        await sock.sendMessage(jid, {
          text: `🚨 @${shortId(actorId)} cut @${shortId(target.id)} loose. They were caught and jailed for 10 minutes. The remaining crew escapes this stage, but the bank haul is reduced by ${fmt(2_000_000)}.`,
          mentions: [actorId, target.id],
        }, { quoted: msg });
        if (results[1].status === "rejected") {
          await sock.sendMessage(jid, {
            text: `⚠️ The jail was recorded, but the heist history for @${shortId(target.id)} could not be saved.`,
            mentions: [target.id],
          });
        }
        reassignUnavailableActors(heist);
      }

      heist.cashBonus = (heist.cashBonus || 0) + (task.cashBonus || 0);
      heist.actorIndex += 1;
      if (heist.actorIndex >= task.actorIds.length) {
        heist.taskIndex += 1;
        heist.actorIndex = 0;
      }

      if (heist.taskIndex >= heist.tasks.length) {
        return completeHeist(sock, jid, heist);
      }

      if (outcome === "success") {
        await sock.sendMessage(jid, {
          text: `✅ @${shortId(actorId)} completed the ${task.stage.toLowerCase()} action.`,
          mentions: [actorId],
        }, { quoted: msg });
      }
      return sendCurrentHeistTask(sock, jid, heist);
    }

    // ── STATUS ─────────────────────────────────────────────────────────────────
    if (sub === "status") {
      const heist = activeHeists.get(jid);
      if (!heist) return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ℹ️  *Status*  :: *NO ACTIVE HEIST*
│
│ 💡 Start with *.heist* and bring at least one crew member.
╰───────────────❀`
      );
      const names = heist.members.map((member) =>
        `│   • @${shortId(member.id)}${member.abandoned ? " — left behind" : ""}`
      ).join("\n");
      const task = heist.phase === "tasks" ? heist.tasks[heist.taskIndex] : null;
      const currentActor = task?.actorIds[heist.actorIndex];
      const phaseText = heist.phase === "tasks"
        ? `│ 🎯 *Stage*   :: *${heist.taskIndex + 1}/${heist.tasks.length} · ${task?.stage || "Preparing"}*\n│ 🕵️ *Turn*    :: *${currentActor ? `@${shortId(currentActor)}` : "Resolving"}*\n│ ⏳ *Time*    :: *${Math.max(0, Math.ceil((heist.taskDeadline - Date.now()) / 1000))}s*`
        : heist.phase === "recruiting"
          ? `│ ⏳ *Starts*  :: *${Math.max(0, Math.ceil((heist.startsAt - Date.now()) / 1000))}s*`
          : "│ ⏳ *Phase*   :: *Preparing tasks*";
      return await sock.sendMessage(jid, {
        text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Status*  :: *ACTIVE 🟢*
│
│ 💰 *Entry*   :: *${fmt(heist.stake)} per person*
│ 👥 *Crew*    :: *${heist.members.length}/${MAX_HEIST_MEMBERS} · ${MIN_MEMBERS} minimum*
${phaseText}
│
│ 🦹 *Crew Members:*
${names}
│
│ 💡 ${heist.phase === "tasks" ? "Follow the active task in chat." : heist.phase === "recruiting" ? "Join with *.heist join*" : "The join window is closing."}
╰───────────────❀`,
        mentions: [...heist.members.map(m => m.id), ...(currentActor ? [currentActor] : [])],
      }, { quoted: msg });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────────
    if (sub === "cancel") {
      const heist = activeHeists.get(jid);
      if (!heist) return reply("❌ No active heist to cancel.");
      if (heist.starter !== sender) return reply("❌ Only the heist starter can cancel it.");
      if (heist.phase !== "recruiting") return reply("❌ The heist cannot be cancelled after tasks begin.");
      if (heist.pendingJoins > 0) return reply("⏳ A join is still processing. Try cancelling again in a moment.");

      clearTimeout(heist.timeout);
      for (const m of heist.members) {
        const u = await getUser(m.id);
        u.money = (u.money || 0) + m.stake;
        refundHeistItems(u);
        await saveUser(m.id, u);
      }
      activeHeists.delete(jid);

      return await sock.sendMessage(jid, {
        text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *CANCELLED 🔴*
│
│ 💰 All stakes have been *refunded*
╰───────────────❀`,
        mentions: heist.members.map(m => m.id),
      }, { quoted: msg });
    }

    // ── JOIN ───────────────────────────────────────────────────────────────────
    if (sub === "join") {
      const heist = activeHeists.get(jid);
      if (!heist) return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NO HEIST 🔴*
│
│ 💡 Start one with *.heist* and recruit at least one crew member.
╰───────────────❀`
      );
      if (heist.phase !== "recruiting") return reply("❌ The crew is already completing heist tasks.");
      if (heist.members.length + heist.pendingJoins >= MAX_HEIST_MEMBERS) {
        return reply(`❌ This crew is full. A heist can have up to ${MAX_HEIST_MEMBERS} players.`);
      }
      if (
        heist.members.find((member) => member.id === sender) ||
        heist.joiningMembers.has(sender)
      ) return reply("❌ You're already in or joining this heist.");

      heist.pendingJoins += 1;
      heist.joiningMembers.add(sender);
      try {
        const user = await getUser(sender);
        if (!hasActiveGun(user)) {
          return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NO GUN 🔴*
│
│ 🔫 Buy a gun from *.shop weapons* before joining.
│ ⏳ A gun remains active for *3 days*.
╰───────────────❀`
          );
        }
        if (!hasHeistItems(user)) return reply("Buy a Hack Kit and Med Kit from .shop before joining a heist.");
        if ((user.money || 0) < ENTRY_FEE) {
          return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NOT ENOUGH 🔴*
│
│ 💰 *Need*    :: *${fmt(ENTRY_FEE)}*
│ 💰 *Have*    :: *${fmt(user.money)}*
╰───────────────❀`
          );
        }

        user.money -= ENTRY_FEE;
        consumeHeistItems(user);
        await saveUser(sender, user);
        heist.members.push({ id: sender, stake: ENTRY_FEE });

        return await sock.sendMessage(jid, {
          text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *JOINED 🟢*
│ 🍃 *Flavour* :: _仲間に加わった！_
│
│ 👤 *Member*  :: *@${sender.split("@")[0]}*
│ 💰 *Entry*   :: *${fmt(ENTRY_FEE)}*
│ 👥 *Crew*    :: *${heist.members.length} member(s)*
│
│ 💡 Still time to join with *.heist join*!
╰───────────────❀`,
          mentions: [sender],
        }, { quoted: msg });
      } finally {
        heist.pendingJoins -= 1;
        heist.joiningMembers.delete(sender);
        if (heist.phase === "closing" && heist.pendingJoins === 0) {
          await startHeistTasks(sock, jid, heist);
        }
      }
    }

    // ── START HEIST ────────────────────────────────────────────────────────────
    if (activeHeists.has(jid)) {
      return reply("❌ There's already an active heist.\n\nUse *.heist join* to join it.");
    }

    if (sub === "solo") {
      return reply(`Heists are crew-only. Start with *.heist* and wait for at least ${MIN_MEMBERS} players.`);
    }
    const requestedEntry = sub === "start" || !sub
      ? ENTRY_FEE
      : /^1(?:000000|m)$/i.test(sub)
        ? ENTRY_FEE
        : Number.NaN;
    if (requestedEntry !== ENTRY_FEE) {
      return reply(`Each heist has a fixed *${fmt(ENTRY_FEE)}* entry fee. Start a crew with *.heist*.`);
    }
    const stake = ENTRY_FEE;

    const user = await getUser(sender);
    if (!hasActiveGun(user)) {
      return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NO GUN 🔴*
│
│ 🔫 Buy a gun from *.shop weapons* before starting.
│ ⏳ A gun remains active for *3 days*.
╰───────────────❀`
      );
    }
    if (!hasHeistItems(user)) return reply("Buy a Hack Kit and Med Kit from .shop before starting a heist.");
    if ((user.money || 0) < stake) {
      return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NOT ENOUGH 🔴*
│
│ 💰 *Need*    :: *${fmt(stake)}*
│ 💰 *Have*    :: *${fmt(user.money)}*
╰───────────────❀`
      );
    }

    user.money -= stake;
    consumeHeistItems(user);
    await saveUser(sender, user);

    const heist = {
      starter:  sender,
      stake,
      members:  [{ id: sender, stake }],
      phase:    "recruiting",
      startsAt: Date.now() + JOIN_WINDOW,
      timeout:  null,
      taskTimeout: null,
      tasks: [],
      taskIndex: 0,
      actorIndex: 0,
      resolving: false,
      pendingJoins: 0,
      joiningMembers: new Set(),
      cashBonus: 0,
      lootPenalty: 0,
    };

    activeHeists.set(jid, heist);

    heist.timeout = setTimeout(async () => {
      const h = activeHeists.get(jid);
      if (!h || h.phase !== "recruiting") return;
      h.phase = "closing";
      if (h.pendingJoins === 0) await startHeistTasks(sock, jid, h);
    }, JOIN_WINDOW);

    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *STARTED 🟢*
│ 🍃 *Flavour* :: _強盗開始！仲間を集めろ！_
│
│ 💰 *Entry*   :: *${fmt(stake)} per person*
│ ⏳ *Window*  :: *60 seconds to join*
│ 👥 *Crew*    :: *${MIN_MEMBERS}–${MAX_HEIST_MEMBERS} players*
│ 🎯 *Stages*  :: *${HEIST_TASK_COUNT} security stages*
│
│ 👤 Starter: *@${sender.split("@")[0]}*
│ 💡 Crew members join with *.heist join*. No solo runs.
╰───────────────❀`,
      mentions: [sender],
    }, { quoted: msg });
  },
};

function shortId(id) {
  return id.split("@")[0].split(":")[0];
}

function activeCrew(heist) {
  return heist.members.filter((member) => !member.abandoned);
}

function reassignUnavailableActors(heist) {
  const crew = activeCrew(heist);
  if (!crew.length) return;
  let replacementIndex = 0;
  for (let index = heist.taskIndex + 1; index < heist.tasks.length; index++) {
    const task = heist.tasks[index];
    if (task.actorIds.every((id) => !crew.some((member) => member.id === id))) {
      task.actorIds = [crew[replacementIndex % crew.length].id];
      replacementIndex++;
    }
    if (!crew.some((member) => member.id === task.targetId)) {
      const replacement = crew.find((member) => member.id !== task.actorIds[0]) || crew[0];
      task.prompt = task.prompt.replace(`@${shortId(task.targetId)}`, `@${shortId(replacement.id)}`);
      task.targetId = replacement.id;
    }
  }
}

async function startHeistTasks(sock, jid, heist) {
  if (activeHeists.get(jid) !== heist || heist.phase !== "closing") return;
  heist.phase = "starting";

  if (heist.members.length < MIN_MEMBERS) {
    activeHeists.delete(jid);
    for (const member of heist.members) {
      const user = await getUser(member.id);
      user.money = (user.money || 0) + member.stake;
      refundHeistItems(user);
      await saveUser(member.id, user);
    }
    return sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *ABORTED 🔴*
│ 🍃 *Flavour* :: _Not enough crew members joined._
│
│ 👥 *Need*    :: *${MIN_MEMBERS} members*
│ 💰 *Stakes*  :: *Fully refunded*
╰───────────────❀`,
      mentions: heist.members.map((member) => member.id),
    });
  }

  heist.phase = "tasks";
  heist.tasks = createHeistTasks(heist.members.map((member) => member.id));
  heist.taskIndex = 0;
  heist.actorIndex = 0;
  heist.resolving = false;
  await sock.sendMessage(jid, {
    text:
`🚨 *The heist is underway!*
The crew faces *${heist.tasks.length} stages* from recon to getaway. Every player gets a turn.
Hard stages have more choices and only *15 seconds*. A wrong move or timeout can jail the active crew for *10 minutes*.
At the rescue stage, the assigned player may save a teammate or leave them behind. At the getaway, a risky double-cross can take the whole haul.`,
    mentions: heist.members.map((member) => member.id),
  });
  return sendCurrentHeistTask(sock, jid, heist);
}

async function sendCurrentHeistTask(sock, jid, heist) {
  if (activeHeists.get(jid) !== heist || heist.phase !== "tasks") return;
  const task = heist.tasks[heist.taskIndex];
  const actorId = task?.actorIds[heist.actorIndex];
  if (!task || !actorId) return failHeist(sock, jid, heist, "The task could not be loaded.");

  clearTimeout(heist.taskTimeout);
  const timeLimit = Number(task.timeLimitMs) || TASK_TIMEOUT;
  heist.taskDeadline = Date.now() + timeLimit;
  const taskIndex = heist.taskIndex;
  const actorIndex = heist.actorIndex;
  heist.taskTimeout = setTimeout(() => {
    if (
      activeHeists.get(jid) !== heist ||
      heist.phase !== "tasks" ||
      heist.resolving ||
      heist.taskIndex !== taskIndex ||
      heist.actorIndex !== actorIndex
    ) return;
    heist.resolving = true;
    void failHeist(sock, jid, heist, "A crew member ran out of time.", actorId);
  }, timeLimit);

  const mentions = [...new Set([actorId, task.targetId])];
  const taskTurn = task.actorIds.length > 1
    ? ` · Crew turn ${heist.actorIndex + 1}/${task.actorIds.length}`
    : "";
  try {
    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓 ${task.stage} · ${heist.taskIndex + 1}/${heist.tasks.length}* 」❀─╮
│ 👤 Assigned :: @${shortId(actorId)}${taskTurn}
│ ⚠️ Difficulty :: *${task.difficulty || "NORMAL"}* · *${Math.ceil(timeLimit / 1000)}s*
│
│ ${task.prompt}
│
${task.options.map((option, index) => `│ ${index + 1}. ${option}`).join("\n")}
│
│ Reply with *.heist do <number>* before time runs out
╰───────────────❀`,
      mentions,
    });
  } finally {
    heist.resolving = false;
  }
}

async function completeHeist(sock, jid, heist, { betrayerId = null } = {}) {
  if (activeHeists.get(jid) !== heist) return;
  const survivors = activeCrew(heist);
  if (betrayerId && !survivors.some((member) => member.id === betrayerId)) {
    return failHeist(sock, jid, heist, "The betrayer was already left behind.", betrayerId);
  }
  activeHeists.delete(jid);
  clearTimeout(heist.taskTimeout);

  const bankLoot = Math.max(
    1_000_000,
    heist.members.length * 10_000_000 +
      Math.floor(Math.random() * 8_000_001) +
      (heist.cashBonus || 0) -
      (heist.lootPenalty || 0),
  );
  const payouts = calculateHeistPayouts(heist.members, bankLoot, betrayerId);

  if (betrayerId) {
    const betrayer = survivors.find((member) => member.id === betrayerId);
    const caught = survivors.filter((member) => member.id !== betrayerId);
    const jailResults = await Promise.allSettled(
      caught.flatMap((member) => [
        jailUser(member.id, JAIL_DURATION),
        addHistory(member.id, "jail", 0, "Left behind during a heist double-cross; jailed for 10 minutes"),
      ]),
    );
    caught.forEach((member) => { member.abandoned = true; });
    const payout = payouts.get(betrayer.id);
    const user = await getUser(betrayer.id);
    user.money = (user.money || 0) + payout;
    await saveUser(betrayer.id, user);
    await addHistory(betrayer.id, "rob", payout - betrayer.stake, `Heist double-cross payout ${fmt(payout)}`);

    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*   :: *DOUBLE-CROSS 🟡*
│ 🍃 *Flavour*  :: _The crew was betrayed at the getaway._
│
│ 💰 *Bank haul* :: *${fmt(bankLoot)}*
│ 💰 *Taken by*  :: *@${shortId(betrayer.id)} — ${fmt(payout)}*
│ 🔒 *Left behind* :: *The rest of the crew is jailed for 10 minutes.*
╰───────────────❀`,
      mentions: heist.members.map((member) => member.id),
    });
    if (jailResults.some((result) => result.status === "rejected")) {
      await sock.sendMessage(jid, {
        text: "⚠️ One or more jail records could not be saved. Please check the bot database.",
        mentions: caught.map((member) => member.id),
      });
    }
    return;
  }

  const payoutPerMember = Math.floor(bankLoot / survivors.length);
  for (const member of survivors) {
    const payout = payouts.get(member.id);
    const user = await getUser(member.id);
    user.money = (user.money || 0) + payout;
    await saveUser(member.id, user);
    await addHistory(member.id, "rob", payout - member.stake, `Heist payout ${fmt(payout)}`);
  }

  const mentions = heist.members.map((member) => member.id);
  const tags = survivors.map((member) => `@${shortId(member.id)}`).join(" ");
  const leftBehind = heist.members.filter((member) => member.abandoned);
  const leftBehindText = leftBehind.length
    ? `\n│ 🧍 *Left behind* :: ${leftBehind.map((member) => `@${shortId(member.id)}`).join(" ")}`
    : "";
  await sock.sendMessage(jid, {
    text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*   :: *SUCCESS 🟢*
│ 🍃 *Flavour*  :: _The crew cleared ${heist.tasks.length} security stages._
│
│ 💰 *Bank haul* :: *${fmt(bankLoot)}*
│ 💰 *Per Head*  :: *+${fmt(payoutPerMember)} plus stake returned*
│
│ 🦹 *Crew escaped:* ${tags}${leftBehindText}
╰───────────────❀`,
    mentions,
  });
}

async function failHeist(sock, jid, heist, reason, mistakeId = null) {
  if (activeHeists.get(jid) !== heist) return;
  activeHeists.delete(jid);
  heist.phase = "failed";
  clearTimeout(heist.timeout);
  clearTimeout(heist.taskTimeout);

  const caught = activeCrew(heist);
  const jailResults = await Promise.allSettled(
    caught.map((member) => jailUser(member.id, JAIL_DURATION)),
  );
  await Promise.allSettled(
    caught.map((member) => addHistory(
      member.id,
      "jail",
      0,
      "Heist failed; jailed for 10 minutes",
    )),
  );

  const totalPot = heist.members.reduce((sum, member) => sum + member.stake, 0);
  const mentions = heist.members.map((member) => member.id);
  const tags = caught.map((member) => `@${shortId(member.id)}`).join(" ");
  const leftBehind = heist.members
    .filter((member) => member.abandoned)
    .map((member) => `@${shortId(member.id)}`)
    .join(" ");
  const mistakeTag = mistakeId ? ` @${shortId(mistakeId)}` : "";
  await sock.sendMessage(jid, {
    text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *FAILED 🔴*
│ 🍃 *Reason*  :: ${reason}${mistakeTag}
│
│ 💸 *Lost*    :: *${fmt(totalPot)} (all stakes)*
│ 🔒 *Penalty* :: *Active crew jailed for 10 minutes*
│
│ ${tags}
${leftBehind ? `│ Already caught: ${leftBehind}\n` : ""}│
╰───────────────❀`,
    mentions,
  });

  const failedJails = jailResults
    .map((result, index) => result.status === "rejected" ? caught[index].id : null)
    .filter(Boolean);
  if (failedJails.length) {
    await sock.sendMessage(jid, {
      text: "⚠️ Some jail records could not be saved. Please retry the heist after checking the bot database.",
      mentions: failedJails,
    });
  }
}
