import { getTrainer } from "../../lib/pokemon/players.mjs";
import { getPokemonAchievements, setPokemonTitle } from "../../lib/pokemon/progression.mjs";

export default {
  name: "pachievements",
  description: "View Pokémon achievements and set an earned title",
  category: "pokemon",
  usage: ".pachievements | .pachievements title <id>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const trainer = await getTrainer(sender);
    if (!trainer) return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });

    if (String(args[0] || "").toLowerCase() === "title") {
      const result = await setPokemonTitle(sender, String(args[1] || "").toLowerCase());
      if (!result.ok) {
        const text = result.notFound
          ? "Start your Pokémon journey first."
          : result.invalid
            ? "Unknown title. Use .pachievements to see available achievement IDs."
            : `That title is locked. Complete: ${result.achievement.detail}.`;
        return sock.sendMessage(jid, { text }, { quoted: msg });
      }
      return sock.sendMessage(jid, { text: `${result.title} is now your trainer title.` }, { quoted: msg });
    }

    const achievements = getPokemonAchievements(trainer);
    const lines = achievements.map((item) => {
      const state = item.unlocked ? "UNLOCKED" : `${Math.min(item.progress, item.goal)}/${item.goal}`;
      return `${item.unlocked ? "✓" : "·"} ${item.title} — ${item.detail} (${state})\n   ID: ${item.id}`;
    });
    return sock.sendMessage(jid, {
      text: `Pokémon achievements\n\n${lines.join("\n\n")}\n\nSet an earned title with .pachievements title <id>.`,
    }, { quoted: msg });
  },
};
