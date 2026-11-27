import { fetchPokemon } from "../../lib/pokemon/api.mjs";

export default {
  name: "pokedex",
  aliases: ["pokeinfo", "dex"],
  category: "pokemon",
  description: "Get detailed information about a Pokémon",
  usage: ".pokedex <pokemon_name>",

  async run({ sock, msg, args }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    
    const query = args[0]?.toLowerCase();
    if (!query) return reply("❌ Please provide a Pokémon name.");

    try {
      const data = await fetchPokemon(query);
      
      const stats = [["HP", data.baseHp], ["ATTACK", data.baseAttack], ["DEFENSE", data.baseDefense],
        ["SPECIAL ATTACK", data.baseSpAtk], ["SPECIAL DEFENSE", data.baseSpDef], ["SPEED", data.baseSpeed]]
        .map(([name, value]) => `• *${name}:* ${value}`).join("\n");
      const types = data.types.map(t => t.toUpperCase()).join(", ");
      const abilities = data.abilities.join(", ");
      
      const caption = `
📕 *POKEDEX: #${data.pokedexId} ${data.name.toUpperCase()}* 📕
━━━━━━━━━━━━━━━━━━━━━
🏷️ *Types:* ${types}
📏 *Height:* ${data.height / 10}m
⚖️ *Weight:* ${data.weight / 10}kg
✨ *Abilities:* ${abilities}

📊 *Base Stats:*
${stats}
━━━━━━━━━━━━━━━━━━━━━
`;

      return sock.sendMessage(jid, {
        image: { url: data.imageUrl },
        caption
      }, { quoted: msg });

    } catch (err) {
      return reply("❌ Pokémon not found. Check the spelling!");
    }
  },
};
