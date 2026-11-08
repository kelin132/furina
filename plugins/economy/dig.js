import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds, checkLevelUp } from "./database.js";
import { DIG_LOOT, getItemDefinition, rollLoot } from "./_items.js";

const COOLDOWN = 10 * 1000; // 10 seconds

function fmt(n) {
  const amount = Math.max(0, Number(n) || 0);
  if (amount >= 1e9) return `$${(amount / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function articleFor(value) {
  return /^[aeiou]/i.test(value) ? "an" : "a";
}

export default {
  name: "dig",
  aliases: ["mine"],
  category: "economy",
  cooldown: 6,
  description: "Dig for buried treasure — cash, items, or orbs (10 sec cooldown)",
  usage: ".dig",

  async run({ sock, msg, sender, cmd }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid = msg.key.remoteJid;
    const action = String(cmd || "dig").toLowerCase() === "mine" ? "mine" : "dig";
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    const now = Date.now();

    const user = await getUser(sender);

    if (!(user.inventory || []).includes("pickaxe")) {
      return reply("Buy a Pickaxe from .shop before mining.");
    }

    if (now - (user.lastDig || 0) < COOLDOWN) {
      const rem = COOLDOWN - (now - user.lastDig);
      const secs = Math.ceil(rem / 1000);
      return reply(`⏳ Your ${action} cooldown is still active — ${secs}s left.`);
    }

    const loot = rollLoot(DIG_LOOT);
    user.lastDig = now;
    const hasDiamondShovel = (user.inventory || []).includes("diamond_shovel");
    const diamondReward = maybeAwardDiamonds(user, hasDiamondShovel ? 0.01 : 0.005, 1, 2);

    let resultLine;

    if (loot.type === "cash") {
      const amount = Math.floor(Math.random() * (loot.max - loot.min + 1)) + loot.min;
      user.money = (user.money || 0) + amount;
      await addHistory(sender, "dig", amount, `Dug up $${amount.toLocaleString()}`);
      resultLine = `⛏️ You dug and found ${fmt(amount)} in the ground!`;
    } else if (loot.type === "item") {
      user.inventory = user.inventory || [];
      user.inventory.push(loot.name);
      const def = getItemDefinition(loot.name);
      const itemValue = Math.floor(Math.random() * 750) + 150; // Random value $150-$900 per item
      user.money = (user.money || 0) + itemValue;
      resultLine = `⛏️ You dug and found ${def?.emoji || "📦"} ${articleFor(loot.name)} ${loot.name}! (+${fmt(itemValue)})`;
      await addHistory(sender, "dig", itemValue, `Dug up ${loot.name}`);
    } else if (loot.type === "orbs") {
      const amount = Math.floor(Math.random() * (loot.max - loot.min + 1)) + loot.min;
      user.orbs = (user.orbs || 0) + amount;
      resultLine = `⛏️ You dug and found ${amount} orb${amount === 1 ? "" : "s"}!`;
      await addHistory(sender, "dig", 0, `Dug up ${amount} orbs`);
    } else {
      resultLine = "⛏️ You dug and found only a rock. Better luck next time!";
    }

    user.xp = (user.xp || 0) + 10;
    const { leveled, newLevel } = checkLevelUp(user);
    await saveUser(sender, user);

    const details = [
      resultLine,
      "",
      `Wallet: ${fmt(user.money || 0)} • Orbs: ${user.orbs || 0} • Items: ${(user.inventory || []).length} • XP: +10.`,
    ];
    if (diamondReward) details.push(`💎 Bonus: +${diamondReward} Gem${diamondReward === 1 ? "" : "s"}`);
    if (leveled) details.push(`🎉 Level up! You are now level ${newLevel}.`);

    return reply(details.join("\n"));
  },
};
