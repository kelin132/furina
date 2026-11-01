// plugins/pokemon/spawnpokemon.js
// Mods/Owners: spawn a specific Pokémon in the group (or give to a user)

import { fetchPokemon, getImageMessage } from "../../lib/pokemon/api.mjs";
import { getWild, setWild, clearWild, reserveWildSpawn, releaseWildSpawn } from "../../lib/pokemon/wildState.mjs";
import { getMovesForType } from "../../lib/pokemon/gameLogic.mjs";
import { getRepel } from "../../lib/pokemon/itemState.mjs";

export default {
  name: "spawnpokemon",
  aliases: ["spawnnpc", "modspawn"],
  description: "[Mod/Owner] Spawn a chosen Pokémon at a random level from 12 to 14",
  category: "pokemon",
  usage: ".spawnpokemon <name or number>",
  isMod: true,
  isPremium : true,
  hidden: true,

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;

    if (getRepel(jid)) {
      return sock.sendMessage(jid, {
        text: "🌿 A Repel is active in this group, so a wild Pokémon cannot be spawned yet.",
      }, { quoted: msg });
    }

    if (getWild(jid)) {
      return sock.sendMessage(jid, {
        text: "⚠️ A wild Pokémon is already here. Use *.catch* before spawning another.",
      }, { quoted: msg });
    }

    if (!args[0]) {
      return sock.sendMessage(jid, {
        text: "Usage: *.spawnpokemon <name or number>*\nExample: `.spawnpokemon pikachu` or `.spawnpokemon 25`",
      }, { quoted: msg });
    }

    if (args.length > 1) {
      return sock.sendMessage(jid, {
        text: "Custom levels are disabled. The Pokémon level is randomly chosen from 12 to 14.\nUsage: `.spawnpokemon <name or number>`",
      }, { quoted: msg });
    }

    if (!reserveWildSpawn(jid)) {
      return sock.sendMessage(jid, {
        text: "⏳ A Pokémon spawn is already being prepared for this group. Try again in a moment.",
      }, { quoted: msg });
    }

    let apiData;
    try {
      apiData = await fetchPokemon(args[0]);
    } catch {
      releaseWildSpawn(jid);
      return sock.sendMessage(jid, {
        text: `❌ Couldn't find a Pokémon named *${args[0]}*. Check the name and try again.`,
      }, { quoted: msg });
    }

    const level = 12 + Math.floor(Math.random() * 3);
    const maxHp = Math.max(10, Math.floor(apiData.baseHp * (1 + level * 0.05)));
    const wildPoke = {
      pokedexId: apiData.pokedexId,
      name: apiData.name,
      displayName: apiData.displayName,
      types: apiData.types,
      primaryType: apiData.primaryType,
      level,
      hp: maxHp,
      maxHp,
      attack: Math.max(5, Math.floor(apiData.baseAttack * (1 + level * 0.05))),
      defense: Math.max(5, Math.floor(apiData.baseDefense * (1 + level * 0.05))),
      speed: Math.max(5, Math.floor(apiData.baseSpeed * (1 + level * 0.05))),
      imageUrl: apiData.imageUrl,
      moves: getMovesForType(apiData.primaryType, apiData.types, level),
    };

    setWild(jid, wildPoke, sender);

    const typeEmojis = { fire:"🔥",water:"💧",grass:"🍃",electric:"⚡",psychic:"🔮",
      normal:"⭐",flying:"🌤️",bug:"🐛",poison:"☠️",rock:"🪨",ground:"🌍",
      ice:"❄️",fighting:"🥊",ghost:"👻",dragon:"🐉",dark:"🌑",steel:"⚙️",fairy:"🌸" };
    const typeStr = apiData.types.map(t => `${typeEmojis[t]||""}${t}`).join(" / ");

    const summonCaption =
`✨ *A SPECIAL POKÉMON WAS SUMMONED!*

🐾 Name: *${wildPoke.displayName}*
🏷️ Type: ${typeStr}
📊 Level: ${level}
❤️ HP: ${maxHp}/${maxHp}

Use *.catch* to battle this Pokémon!
⏰ It will flee in 30 minutes.`;

    try {
      // Use the provider image when available, then fall back to text.
      const imgMsg = await getImageMessage(apiData);
      if (imgMsg) {
        try {
          await sock.sendMessage(jid, { ...imgMsg, caption: summonCaption }, { quoted: msg });
          return;
        } catch { /* fall through to text */ }
      }
      await sock.sendMessage(jid, { text: summonCaption }, { quoted: msg });
    } catch (error) {
      clearWild(jid);
      throw error;
    } finally {
      releaseWildSpawn(jid);
    }
  },
};
