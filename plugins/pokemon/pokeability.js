/**
 * KELIN MD — .pokeability
 * Fetches info about a Pokemon ability.
 */
import { fetchApiResource } from "../../lib/pokemon/api.mjs";

export default {
  name: "pokeability",
  aliases: ["pokemonability", "pa"],
  description: "Get info about a Pokemon ability",
  category: "pokemon",
  usage: ".pokeability <name>",

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;
    if (!text) return sock.sendMessage(jid, { text: "Usage: .pokeability <name> (e.g. Overgrow)" }, { quoted: msg });

    try {
      const data = await fetchApiResource("abilities", text);
      const effect = data.Description || "No description available.";

      const caption = `
✨ *POKEMON ABILITY* ✨

🔮 *Name:* ${data.Name.toUpperCase()}
📝 *Effect:*
${effect}
`.trim();

      await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    } catch (err) {
      console.error(err);
      await sock.sendMessage(jid, { text: "❌ Failed to fetch ability info." }, { quoted: msg });
    }
  },
};
