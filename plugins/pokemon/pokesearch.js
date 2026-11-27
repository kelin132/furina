/**
 * KELIN MD — .pokesearch command
 * Search for Pokémon info using Eula PokéAPI.
 */
import { fetchPokemon } from "../../lib/pokemon/api.mjs";

export default {
  name: "pokesearch",
  description: "Search for Pokémon information",
  category: "pokemon",
  usage: ".pokesearch <pokemon name/id>",
  aliases: ["psearch", "pokeinfo"],
  cooldown: 5,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;

    if (!text) {
      return sock.sendMessage(jid, {
        text: "🎮 *Pokémon Search*\n\nUsage: *.pokesearch <name/id>*\nExample: *.pokesearch pikachu*"
      }, { quoted: msg });
    }

    const query = text.trim().toLowerCase();
    
    try {
      await sock.sendMessage(jid, { react: { text: "🔍", key: msg.key } });
      
      const data = await fetchPokemon(query);
      
      const name = data.name.charAt(0).toUpperCase() + data.name.slice(1);
      const types = data.types.map(t => t.toUpperCase()).join(", ");
      const stats = [["HP", data.baseHp], ["ATTACK", data.baseAttack], ["DEFENSE", data.baseDefense],
        ["SPECIAL ATTACK", data.baseSpAtk], ["SPECIAL DEFENSE", data.baseSpDef], ["SPEED", data.baseSpeed]]
        .map(([label, value]) => `• ${label}: ${value}`).join("\n");
      const abilities = data.abilities.join(", ");
      
      const caption = `🎮 *POKÉMON INFO: ${name} (#${data.pokedexId})*\n\n` +
        `✨ *Type:* ${types}\n` +
        `📏 *Height:* ${data.height / 10}m | ⚖️ *Weight:* ${data.weight / 10}kg\n` +
        `🧬 *Abilities:* ${abilities}\n\n` +
        `📊 *Base Stats:*\n${stats}`;
      
      const imageUrl = data.imageUrl;
      
      await sock.sendMessage(jid, { image: { url: imageUrl }, caption }, { quoted: msg });
      await sock.sendMessage(jid, { react: { text: "✅", key: msg.key } });
    } catch (err) {
      await sock.sendMessage(jid, { text: `❌ ${err.message}` }, { quoted: msg });
    }
  }
};
