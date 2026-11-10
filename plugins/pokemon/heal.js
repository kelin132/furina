// plugins/pokemon/heal.js
// Heal all Pokémon in party — FREE, 150-second cooldown

import { getTrainer } from "../../lib/pokemon/players.mjs";
import { getTrainerParty, healParty } from "../../lib/pokemon/pokemonDb.mjs";
import { findActivePokemonBattle } from "../../lib/pokemon/activeBattle.mjs";
import { readPokemonAnimation } from "../../lib/pokemon/media.mjs";

export default {
  name: "heal",
  aliases: ["pokecenter", "healparty"],
  description: "Heal all Pokémon in your party (free, 150s cooldown)",
  category: "pokemon",
  usage: ".heal",
  cooldown: 150,

  async run({ sock, msg, sender }) {
    const jid = msg.key.remoteJid;

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, { text: "❌ Start your journey first! Use ``.startjourney``" }, { quoted: msg });
    }

    let activeBattle;
    try {
      activeBattle = await findActivePokemonBattle(sender);
    } catch (error) {
      console.error("[pokemon-heal] battle status lookup failed:", error?.message || error);
      return sock.sendMessage(jid, {
        text: "⚠️ I couldn't verify your battle status, so I paused healing. Please try again shortly.",
      }, { quoted: msg });
    }
    if (activeBattle) {
      return sock.sendMessage(jid, {
        text: "❌ *You can't heal your party while a Pokémon battle is active.*\n\nFinish or flee your battle first. This applies in every group and during website battles.",
      }, { quoted: msg });
    }

    const party = await getTrainerParty(sender);
    if (!party || party.length === 0) {
      return sock.sendMessage(jid, {
        text: "❌ Your party is empty! Use ``.t2party`` to add Pokémon.",
      }, { quoted: msg });
    }

    const allHealthy = party.every(p => p.hp >= p.maxHp);
    if (allHealthy) {
      return sock.sendMessage(jid, {
        text: "✅ All your Pokémon are already at full health!\n⏳ Next free heal in ``150`` seconds.",
      }, { quoted: msg });
    }

    await healParty(sender);

    const typeEmojis = { fire:"🌋",water:"🌊",grass:"🍃",electric:"⚡",psychic:"🔮",
      normal:"⭐",flying:"🌤️",bug:"🪲",poison:"☠️",rock:"🪨",ground:"🌍",
      ice:"❄️",fighting:"⚔️",ghost:"👻",dragon:"🐉",dark:"🌑",steel:"⚙️",fairy:"🌸" };

    const healed = party.map(p => {
      const icon = typeEmojis[p.primaryType] || "⭐";
      const name = (p.displayName || p.name || "???").padEnd(10);
      return `${icon} ${name} `;
    }).join("\n");

    const hospitalCaption =
      "╭━━〔 🏥 *POKÉMON CENTER* 〕━━╮\n\n" +
      "💚 *HEALING COMPLETE!*\n\n" +
      healed +
      "\n\n💚 *ALL POKEMON HAVE BEEN HEALED*\n⏳ Next heal: 150s\n\n╰━━━━━━━━━━━━━━━━━━╯";
    try {
      const hospitalAnimation = await readPokemonAnimation("pokemon-center");
      await sock.sendMessage(jid, {
        video: hospitalAnimation,
        mimetype: "video/mp4",
        fileName: "pokemon-center.mp4",
        gifPlayback: true,
        caption: hospitalCaption,
      }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, { text: hospitalCaption }, { quoted: msg });
    }
  },
};
