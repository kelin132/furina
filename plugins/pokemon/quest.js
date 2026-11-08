import {
  claimDailyPokemonQuest,
  getTrainer,
} from "../../lib/pokemon/players.mjs";

export default {
  name: "quest",
  aliases: ["dailyquest"],
  description: "Check or claim your daily Pokémon quest",
  category: "pokemon",
  usage: ".quest | .quest claim",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    if (!jid) return;

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, { text: "Start your Pokémon journey before taking quests." }, { quoted: msg });
    }

    if (args[0]?.toLowerCase() === "claim") {
      const result = await claimDailyPokemonQuest(sender);
      if (!result.ok) {
        const text = result.reason === "already-claimed"
          ? "You already claimed today's quest reward."
          : "Win a wild Pokémon battle first, then use .quest claim.";
        return sock.sendMessage(jid, { text }, { quoted: msg });
      }
      return sock.sendMessage(jid, {
        text: `Daily quest complete. Reward: $${result.rewards.coins.toLocaleString()}, ${result.rewards.xp} trainer XP, 3 Apricorns, 1 Iron Ore, 2 Medicinal Herbs, and 1 Crystal Shard.`,
      }, { quoted: msg });
    }

    const today = new Date().toISOString().slice(0, 10);
    const quest = trainer.dailyQuest?.day === today ? trainer.dailyQuest : null;
    const wins = Math.min(1, Number(quest?.wildWins) || 0);
    const claimed = Boolean(quest?.claimed);
    return sock.sendMessage(jid, {
      text: `Daily Pokémon quest: win 1 wild battle (${wins}/1).\nReward: $15,000, 100 trainer XP, and crafting materials.${claimed ? "\nReward claimed." : wins ? "\nUse .quest claim to collect it." : ""}`,
    }, { quoted: msg });
  },
};
