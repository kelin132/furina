/**
 * .heist <amount>  — start a group heist (stake that amount)
 * .heist join      — join the active heist in this group
 * .heist do <1-3>  — answer your assigned heist task
 * .heist cancel    — cancel heist (starter only)
 * .heist status    — check who's joined
 */
import { getUser, saveUser, requireRegistration, addHistory, jailUser } from "./database.js";
import { hasActiveGun } from "../../lib/economySecurity.mjs";
import { createHeistTasks, HEIST_TASK_COUNT, isCorrectHeistAnswer } from "../../lib/heistTasks.mjs";

const JOIN_WINDOW    = 60 * 1000;  // 60 seconds to join
const TASK_TIMEOUT   = 30 * 1000;  // 30 seconds per crew action
const JAIL_DURATION  = 10 * 60 * 1000;
const MIN_STAKE      = 500;
const MAX_STAKE      = 5_000;
const MIN_MEMBERS    = 2;

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
  description: "Run a group heist by completing five crew tasks.",
  usage: ".heist <amount> | join | status | do <1-3> | cancel",
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
      if (!/^[1-3]$/.test(answer || "")) {
        return reply("Choose 1, 2, or 3 with `.heist do <number>`.");
      }

      heist.resolving = true;
      clearTimeout(heist.taskTimeout);
      if (!isCorrectHeistAnswer(task, answer)) {
        return failHeist(sock, jid, heist, "A crew member chose the wrong action.", actorId);
      }

      heist.actorIndex += 1;
      if (heist.actorIndex >= task.actorIds.length) {
        heist.taskIndex += 1;
        heist.actorIndex = 0;
      }

      if (heist.taskIndex >= HEIST_TASK_COUNT) {
        return completeHeist(sock, jid, heist);
      }

      await sock.sendMessage(jid, {
        text: `✅ @${actorId.split("@")[0].split(":")[0]} completed the action.`,
        mentions: [actorId],
      }, { quoted: msg });
      return sendCurrentHeistTask(sock, jid, heist);
    }

    // ── STATUS ─────────────────────────────────────────────────────────────────
    if (sub === "status") {
      const heist = activeHeists.get(jid);
      if (!heist) return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ℹ️  *Status*  :: *NO ACTIVE HEIST*
│
│ 💡 Start one with *.heist <amount>*
╰───────────────❀`
      );
      const names = heist.members.map(m => `│   • @${m.id.split("@")[0].split(":")[0]}`).join("\n");
      const task = heist.phase === "tasks" ? heist.tasks[heist.taskIndex] : null;
      const currentActor = task?.actorIds[heist.actorIndex];
      const phaseText = heist.phase === "tasks"
        ? `│ 🎯 *Task*    :: *${heist.taskIndex + 1}/${HEIST_TASK_COUNT}*\n│ 🕵️ *Turn*    :: *${currentActor ? `@${currentActor.split("@")[0].split(":")[0]}` : "Resolving"}*\n│ ⏳ *Time*    :: *${Math.max(0, Math.ceil((heist.taskDeadline - Date.now()) / 1000))}s*`
        : heist.phase === "recruiting"
          ? `│ ⏳ *Starts*  :: *${Math.max(0, Math.ceil((heist.startsAt - Date.now()) / 1000))}s*`
          : "│ ⏳ *Phase*   :: *Preparing tasks*";
      return await sock.sendMessage(jid, {
        text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Status*  :: *ACTIVE 🟢*
│
│ 💰 *Stake*   :: *${fmt(heist.stake)} per person*
│ 👥 *Crew*    :: *${heist.members.length}/${MIN_MEMBERS} minimum*
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
│ 💡 Start one with *.heist <amount>*
╰───────────────❀`
      );
      if (heist.phase !== "recruiting") return reply("❌ The crew is already completing heist tasks.");
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
        if (user.money < heist.stake) {
          return reply(
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ ❌ *Result*  :: *NOT ENOUGH 🔴*
│
│ 💰 *Need*    :: *${fmt(heist.stake)}*
│ 💰 *Have*    :: *${fmt(user.money)}*
╰───────────────❀`
          );
        }

        user.money -= heist.stake;
        consumeHeistItems(user);
        await saveUser(sender, user);
        heist.members.push({ id: sender, stake: heist.stake });

        return await sock.sendMessage(jid, {
          text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *JOINED 🟢*
│ 🍃 *Flavour* :: _仲間に加わった！_
│
│ 👤 *Member*  :: *@${sender.split("@")[0]}*
│ 💰 *Stake*   :: *${fmt(heist.stake)}*
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

    const stake = parseInt(args[0]);
    if (isNaN(stake) || stake < MIN_STAKE) return reply(`❌ Minimum stake is *${fmt(MIN_STAKE)}*.`);
    if (stake > MAX_STAKE)                  return reply(`❌ Maximum stake is *${fmt(MAX_STAKE)}*.`);

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
    if (user.money < stake) {
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
    };

    heist.timeout = setTimeout(async () => {
      const h = activeHeists.get(jid);
      if (!h || h.phase !== "recruiting") return;
      h.phase = "closing";
      if (h.pendingJoins === 0) await startHeistTasks(sock, jid, h);
    }, JOIN_WINDOW);

    activeHeists.set(jid, heist);

    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *STARTED 🟢*
│ 🍃 *Flavour* :: _強盗開始！仲間を集めろ！_
│
│ 💰 *Stake*   :: *${fmt(stake)} per person*
│ ⏳ *Window*  :: *60 seconds to join*
│ 👥 *Min*     :: *${MIN_MEMBERS} crew members*
│ 🎯 *Tasks*   :: *${HEIST_TASK_COUNT} tasks — one mistake fails*
│
│ 👤 Starter: *@${sender.split("@")[0]}*
│ 💡 Type *.heist join* to join the crew!
╰───────────────❀`,
      mentions: [sender],
    }, { quoted: msg });
  },
};

function shortId(id) {
  return id.split("@")[0].split(":")[0];
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
There are *${HEIST_TASK_COUNT} tasks*. Every crew member gets a turn.
The assigned player has *30 seconds* to answer with \`.heist do 1\`, \`.heist do 2\`, or \`.heist do 3\`.
One wrong answer or a timeout fails the heist and jails the whole crew for *10 minutes*.`,
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
  heist.taskDeadline = Date.now() + TASK_TIMEOUT;
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
  }, TASK_TIMEOUT);

  const mentions = [...new Set([actorId, task.targetId])];
  const taskTurn = task.actorIds.length > 1
    ? ` · Crew turn ${heist.actorIndex + 1}/${task.actorIds.length}`
    : "";
  try {
    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓 TASK ${heist.taskIndex + 1}/${HEIST_TASK_COUNT}* 」❀─╮
│ 👤 Assigned :: @${shortId(actorId)}${taskTurn}
│
│ ${task.prompt}
│
${task.options.map((option, index) => `│ ${index + 1}. ${option}`).join("\n")}
│
│ Reply with *.heist do 1*, *.heist do 2*, or *.heist do 3*
╰───────────────❀`,
      mentions,
    });
  } finally {
    heist.resolving = false;
  }
}

async function completeHeist(sock, jid, heist) {
  if (activeHeists.get(jid) !== heist) return;
  activeHeists.delete(jid);
  clearTimeout(heist.taskTimeout);

  const totalPot = heist.members.reduce((sum, member) => sum + member.stake, 0);
  const payout = Math.floor(totalPot / heist.members.length) + 10_000_000;
  for (const member of heist.members) {
    const user = await getUser(member.id);
    user.money = (user.money || 0) + payout;
    await saveUser(member.id, user);
    await addHistory(member.id, "rob", payout - member.stake, `Heist payout ${fmt(payout)}`);
  }

  const mentions = heist.members.map((member) => member.id);
  const tags = heist.members.map((member) => `@${shortId(member.id)}`).join(" ");
  await sock.sendMessage(jid, {
    text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*   :: *SUCCESS 🟢*
│ 🍃 *Flavour*  :: _The crew completed all ${HEIST_TASK_COUNT} tasks._
│
│ 💰 *Total*    :: *${fmt(payout * heist.members.length)}*
│ 💰 *Per Head* :: *+${fmt(payout)}*
│
│ 🦹 *The full crew escaped!*
│ ${tags}
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

  const jailResults = await Promise.allSettled(
    heist.members.map((member) => jailUser(member.id, JAIL_DURATION)),
  );
  await Promise.allSettled(
    heist.members.map((member) => addHistory(
      member.id,
      "jail",
      0,
      "Heist failed; jailed for 10 minutes",
    )),
  );

  const totalPot = heist.members.reduce((sum, member) => sum + member.stake, 0);
  const mentions = heist.members.map((member) => member.id);
  const tags = heist.members.map((member) => `@${shortId(member.id)}`).join(" ");
  const mistakeTag = mistakeId ? ` @${shortId(mistakeId)}` : "";
  await sock.sendMessage(jid, {
    text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *FAILED 🔴*
│ 🍃 *Reason*  :: ${reason}${mistakeTag}
│
│ 💸 *Lost*    :: *${fmt(totalPot)} (all stakes)*
│ 🔒 *Penalty* :: *All crew jailed for 10 minutes*
│
│ ${tags}
╰───────────────❀`,
    mentions,
  });

  const failedJails = jailResults
    .map((result, index) => result.status === "rejected" ? heist.members[index].id : null)
    .filter(Boolean);
  if (failedJails.length) {
    await sock.sendMessage(jid, {
      text: "⚠️ Some jail records could not be saved. Please retry the heist after checking the bot database.",
      mentions: failedJails,
    });
  }
}
