import { getUser, saveUser, requireRegistration, addHistory, checkLevelUp } from "./database.js";
import { FISH_LOOT, getItemDefinition, rollLoot } from "./_items.js";
import { addItem as addPokemonItem, getTrainer as getPokemonTrainer } from "../../lib/pokemon/players.mjs";

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
  name: "fish",
  aliases: ["fishing"],
  category: "economy",
  cooldown: 6,
  description: "Go fishing for cash, items, or orbs (10 sec cooldown)",
  usage: ".fish",

  async run({ sock, msg, sender }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    const now = Date.now();

    const user = await getUser(sender);

    if (!(user.inventory || []).includes("basic_fishing_rod")) {
      return reply("Buy a Fishing Rod from .shop before fishing.");
    }

    if (now - (user.lastFish || 0) < COOLDOWN) {
      const rem = COOLDOWN - (now - user.lastFish);
      const secs = Math.ceil(rem / 1000);
      return reply(`⏳ Your fish cooldown is still active — ${secs}s left.`);
    }

    let loot = rollLoot(FISH_LOOT);
    let pokemonTrainer = null;
    if (loot.type === "pokemon_ball") {
      pokemonTrainer = await getPokemonTrainer(sender);
      if (!pokemonTrainer) {
        // Don't consume a rare Pokémon reward before a trainer has started a journey.
        loot = { type: "cash", min: 9_000, max: 25_000 };
      }
    }
    user.lastFish = now;

    let resultLine;

    if (loot.type === "cash") {
      const amount = Math.floor(Math.random() * (loot.max - loot.min + 1)) + loot.min;
      user.money = (user.money || 0) + amount;
      await addHistory(sender, "fish", amount, `Caught $${amount.toLocaleString()} worth of fish`);
      resultLine = `🎣 You cast your rod and caught ${fmt(amount)} worth of treasure!`;
    } else if (loot.type === "item") {
      user.inventory = user.inventory || [];
      user.inventory.push(loot.name);
      const def = getItemDefinition(loot.name);
      const itemValue = Math.floor(Math.random() * 500) + 100; // Random value $100-$600 per item
      user.money = (user.money || 0) + itemValue;
      resultLine = `🎣 You cast your rod and caught ${def?.emoji || "📦"} ${articleFor(loot.name)} ${loot.name}! (+${fmt(itemValue)})`;
      await addHistory(sender, "fish", itemValue, `Fished up ${loot.name}`);
    } else if (loot.type === "orbs") {
      const amount = Math.floor(Math.random() * (loot.max - loot.min + 1)) + loot.min;
      user.orbs = (user.orbs || 0) + amount;
      resultLine = `🎣 You cast your rod and caught ${amount} orb${amount === 1 ? "" : "s"} beneath the waves!`;
      await addHistory(sender, "fish", 0, `Fished up ${amount} orbs`);
    } else if (loot.type === "pokemon_ball") {
      const ballName = loot.name === "greatball" ? "Great Ball" : "Poké Ball";
      await addPokemonItem(sender, loot.name, 1);
      resultLine = `🎣 A ${ballName} was tangled in your line and added to your Pokémon Bag!`;
      await addHistory(sender, "fish", 0, `Fished up a ${ballName}`);
    } else {
      resultLine = "🎣 You cast your rod and caught an old boot. Classic!";
    }

    user.xp = (user.xp || 0) + 8;
    const { leveled, newLevel } = checkLevelUp(user);
    await saveUser(sender, user);

    const details = [
      resultLine,
      "",
      `Wallet: ${fmt(user.money || 0)} • Orbs: ${user.orbs || 0} • Items: ${(user.inventory || []).length} • XP: +8.`,
    ];
    if (leveled) details.push(`🎉 Level up! You are now level ${newLevel}.`);

    return reply(details.join("\n"));
  },
};
