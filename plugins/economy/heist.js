/**
 * .heist <amount>  — start a group heist (stake that amount)
 * .heist join      — join the active heist in this group
 * .heist cancel    — cancel heist (starter only)
 * .heist status    — check who's joined
 */
import { getUser, saveUser, requireRegistration, isRegistered, addHistory } from "./database.js";
import { hasActiveGun } from "../../lib/economySecurity.mjs";

const JOIN_WINDOW    = 60 * 1000;  // 60 seconds to join
const MIN_STAKE      = 500;
const MAX_STAKE      = 5_000;
const MIN_MEMBERS    = 2;
const WIN_MULTIPLIER = 1.8;        // 80% profit on each stake
const SUCCESS_RATE   = 0.55;       // 55% success

const activeHeists = new Map();    // jid → { starter, stake, members, timeout }
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
  description: "Start a group heist — recruit your crew and rob the bank together!",
  usage: ".heist <amount>  |  .heist join  |  .heist status  |  .heist cancel",
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
      const names = heist.members.map(m => `│   • @${m.id.split("@")[0]}`).join("\n");
      return await sock.sendMessage(jid, {
        text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Status*  :: *ACTIVE 🟢*
│
│ 💰 *Stake*   :: *${fmt(heist.stake)} per person*
│ 👥 *Crew*    :: *${heist.members.length}/${MIN_MEMBERS} minimum*
│ ⏳ *Starts*  :: *${Math.max(0, Math.ceil((heist.startsAt - Date.now()) / 1000))}s*
│
│ 🦹 *Crew Members:*
${names}
│
│ 💡 Join with *.heist join*
╰───────────────❀`,
        mentions: heist.members.map(m => m.id),
      }, { quoted: msg });
    }

    // ── CANCEL ─────────────────────────────────────────────────────────────────
    if (sub === "cancel") {
      const heist = activeHeists.get(jid);
      if (!heist) return reply("❌ No active heist to cancel.");
      if (heist.starter !== sender) return reply("❌ Only the heist starter can cancel it.");

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
      if (heist.members.find(m => m.id === sender)) return reply("❌ You're already in this heist.");

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
      startsAt: Date.now() + JOIN_WINDOW,
      timeout:  null,
    };

    heist.timeout = setTimeout(async () => {
      const h = activeHeists.get(jid);
      if (!h) return;
      activeHeists.delete(jid);
      await executeHeist(sock, jid, h);
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
│
│ 👤 Starter: *@${sender.split("@")[0]}*
│ 💡 Type *.heist join* to join the crew!
╰───────────────❀`,
      mentions: [sender],
    }, { quoted: msg });
  },
};

async function executeHeist(sock, jid, heist) {
  const totalPot = heist.members.reduce((s, m) => s + m.stake, 0);
  const won      = Math.random() < SUCCESS_RATE && heist.members.length >= MIN_MEMBERS;
  const mentions = heist.members.map(m => m.id);
  const tags     = heist.members.map(m => `@${m.id.split("@")[0]}`).join(" ");

  function fmt(n) {
    if (n >= 1e6) return `$${(n/1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${(n/1e3).toFixed(1)}K`;
    return `$${n.toLocaleString()}`;
  }

  if (won) {
    const payout = Math.floor(totalPot / heist.members.length) + 10_000_000;
    for (const m of heist.members) {
      const u = await getUser(m.id);
      u.money = (u.money || 0) + payout;
      await saveUser(m.id, u);
      await addHistory(m.id, "rob", payout - m.stake, `Heist payout ${fmt(payout)}`);
    }

    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*   :: *SUCCESS 🟢*
│ 🍃 *Flavour*  :: _完璧な強盗！誰も見てない！_
│
│ 💰 *Total*    :: *${fmt(payout * heist.members.length)}*
│ 💰 *Per Head* :: *+${fmt(payout)}*
│
│ 🦹 *The security never saw it coming!*
│ ${tags}
╰───────────────❀`,
      mentions,
    });
  } else {
    if (heist.members.length < MIN_MEMBERS) {
      for (const m of heist.members) {
        const u = await getUser(m.id);
        u.money = (u.money || 0) + m.stake;
        refundHeistItems(u);
        await saveUser(m.id, u);
      }

      return sock.sendMessage(jid, {
        text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *ABORTED 🔴*
│ 🍃 *Flavour* :: _人数不足！作戦中止！_
│
│ 👥 *Need*    :: *${MIN_MEMBERS} members*
│ 💰 *Stakes*  :: *Fully refunded*
╰───────────────❀`,
        mentions,
      });
    }

    await sock.sendMessage(jid, {
      text:
`╭─❀「 🏦 *𝐇𝐄𝐈𝐒𝐓* 」❀─╮
│ 🌙 *Result*  :: *FAILED 🔴*
│ 🍃 *Flavour* :: _警察が来た！全員逃げろ！_
│
│ 💸 *Lost*    :: *${fmt(totalPot)} (all stakes)*
│
│ 🚨 *Everyone lost their stake. 悔しい！*
│ ${tags}
╰───────────────❀`,
      mentions,
    });
  }
}
