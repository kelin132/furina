/**
 * KELIN MD — .pokemove
 * Fetches info about a Pokemon move.
 */
import { fetchApiResource } from "../../lib/pokemon/api.mjs";

export default {
  name: "pokemove",
  aliases: ["pokemonmove", "pm"],
  description: "Get info about a Pokemon move",
  category: "pokemon",
  usage: ".pokemove <name>",

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;
    if (!text) return sock.sendMessage(jid, { text: "Usage: .pokemove <name> (e.g. Thunderbolt)" }, { quoted: msg });

    try {
      const data = await fetchApiResource("moves", text);
      const effect = data.Description || "No description available.";

      const caption = `
⚔️ *POKEMON MOVE* ⚔️

💥 *Name:* ${data.Name.toUpperCase()}
🏷️ *Type:* ${data.Type}
🎯 *Accuracy:* ${data.Accuracy || "Always hits"}
💪 *Power:* ${data.Power || "N/A"}
🌀 *PP:* ${data.TotalPP}

📝 *Effect:*
${effect}
`.trim();

      await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    } catch (err) {
      console.error(err);
      await sock.sendMessage(jid, { text: "❌ Failed to fetch move info." }, { quoted: msg });
    }
  },
};
