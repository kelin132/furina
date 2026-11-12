import { getUser, saveUser, requireRegistration, isRegistered, addHistory, jailUser } from "./database.js";
import { hasActiveGun } from "../../lib/economySecurity.mjs";
import { economyWinRate } from "../../lib/economyOdds.mjs";

function fmt(n) {
  const amount = Math.max(0, Number(n) || 0);
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatRemaining(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export default {
  name: "rob",
  description: "Rob another user — 55% success rate (45-min cooldown)",
  category: "economy",
  cooldown: 6,
  usage: ".rob @user",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    const targetJid = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
      || (args[0]?.match(/^[0-9]+$/) ? `${args[0]}@s.whatsapp.net` : null);

    if (!targetJid) {
      return reply("🦹 Usage: .rob @user\n🎯 55% success chance • 🔫 An active gun is required.");
    }

    if (sender === targetJid) {
      return reply("❌ You can't rob yourself!");
    }

    if (!await isRegistered(targetJid)) {
      return reply("❌ That player is not registered.");
    }

    const robber = await getUser(sender);
    const now    = Date.now();

    if (!hasActiveGun(robber, now)) {
      return reply("🔫 You need an active gun to rob someone. Buy one from .shop weapons first.");
    }

    const cd     = 45 * 60 * 1000;

    if (now - (robber.lastRob || 0) < cd) {
      const remaining = cd - (now - robber.lastRob);
      return reply(`⏳ Your rob cooldown is still active — ${formatRemaining(remaining)} left.`);
    }

    const target = await getUser(targetJid);

    // Check staff immunity — cannot be robbed
    if (target.staffImmunity) {
      return reply("🛡️ This target is protected by staff immunity and cannot be robbed.");
    }

    // Check rob charm
    if (target.robShieldExpiry && target.robShieldExpiry > Date.now()) {
      const minsLeft = Math.ceil((target.robShieldExpiry - Date.now()) / 60000);
      return reply(`🧿 This target is protected by a Rob Charm for about ${minsLeft}m more.`);
    }

    if (target.money < 100) {
      return reply("😂 This target is too broke to rob.");
    }

    // Removed the Math.min(10000, ...) limit:
    const amount  = Math.floor(Math.random() * (target.money * 0.3)) + 100;
    const success = Math.random() < economyWinRate(0.55, robber);

    robber.lastRob = now;

    if (success) {
      target.money -= amount;
      robber.money += amount;
      await saveUser(sender, robber);
      await saveUser(targetJid, target);
      await addHistory(sender,    "rob",        amount,  `Robbed ${target.name}`);
      await addHistory(targetJid, "rob_victim", -amount, `Robbed by ${robber.name}`);

      await reply([
        `🦹 You robbed another player and stole ${fmt(amount)}! ✅ Clean getaway.`,
        "",
        `Wallet: ${fmt(robber.money)} • Orbs: ${robber.orbs || 0} • Items: ${(robber.inventory || []).length} • XP: +0.`,
      ].join("\n"));
    } else {
      const fine   = Math.floor(amount * 0.7);
      robber.money = Math.max(0, robber.money - fine);
      robber.jailed = true;
      robber.jailUntil = Date.now() + 10 * 60 * 1000;
      await saveUser(sender, robber);
      await jailUser(sender, 10 * 60 * 1000);
      await addHistory(sender, "rob", -fine, `Rob failed — fined $${fine.toLocaleString()}`);

      await reply([
        `🚔 You were caught and fined ${fmt(fine)}. You are jailed for 10 minutes.`,
        "",
        `Wallet: ${fmt(robber.money)} • Orbs: ${robber.orbs || 0} • Items: ${(robber.inventory || []).length} • XP: +0.`,
      ].join("\n"));
    }
  }
};
