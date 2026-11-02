// plugins/pokemon/catch.js
// Initiate a battle with the wild Pokémon currently in the group

import { getWild, clearWild } from "../../lib/pokemon/wildState.mjs";
import { getTrainer } from "../../lib/pokemon/players.mjs";
import { getTrainerParty } from "../../lib/pokemon/pokemonDb.mjs";
import { pickLeadFromParty } from "../../lib/pokemon/players.mjs";
import { startWildBattle, hasBattle } from "../../lib/pokemon/battleState.mjs";
import { generateBattleScene } from "../../lib/pokemon/canvas.mjs";
import { TYPE_EMOJIS } from "../../lib/pokemon/gameLogic.mjs";
import { readPokemonAnimation } from "../../lib/pokemon/media.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  name: "catch",
  aliases: ["fight", "c"],
  description: "Battle a wild Pokémon that has appeared",
  category: "pokemon",
  usage: ".catch",

  async run({ sock, msg, sender }) {
    const jid = msg.key.remoteJid;

    const wild = getWild(jid);
    if (!wild) {
      return sock.sendMessage(jid, {
        text: "🌿 No wild Pokémon here right now.\nUse *.spawnpoke* to encounter one!",
      }, { quoted: msg });
    }

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, {
        text: "❌ Start your journey first! Use *.startjourney*",
      }, { quoted: msg });
    }

    if (hasBattle(jid)) {
      return sock.sendMessage(jid, {
        text: "⚔️ A battle is already happening here!",
      }, { quoted: msg });
    }

    const party = await getTrainerParty(sender);
    if (!party || party.length === 0) {
      return sock.sendMessage(jid, {
        text: "❌ You have no Pokémon in your party! Use *.t2party* to move one from PC.",
      }, { quoted: msg });
    }

    // Pick the trainer's designated lead (or first healthy if no lead set)
    const lead = pickLeadFromParty(trainer, party);
    if (!lead || lead.hp <= 0) {
      return sock.sendMessage(jid, {
        text: "💔 All your Pokémon have fainted! Use *.heal* to restore them.",
      }, { quoted: msg });
    }

    // Reserve the encounter before the animation so two users cannot start
    // parallel battles while the three-second introduction is playing.
    const battle = startWildBattle(
      jid,
      { jid: sender, username: trainer.username || msg.pushName || "Trainer", pokemon: lead },
      wild.pokemon
    );
    if (!battle) {
      return sock.sendMessage(jid, { text: "⚔️ This Pokémon is already being battled." }, { quoted: msg });
    }

    const appearedName = wild.pokemon.displayName || wild.pokemon.name;
    const encounterText = `A wild ${appearedName} appeared!`;
    try {
      const animation = await readPokemonAnimation("catch");
      await sock.sendMessage(jid, {
        video: animation,
        mimetype: "video/mp4",
        fileName: "pokemon-encounter.mp4",
        gifPlayback: true,
        caption: encounterText,
      }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, { text: encounterText }, { quoted: msg });
    }
    await sleep(3000);

    let sceneBuffer;
    try {
      sceneBuffer = await generateBattleScene({
        enemy: { name: wild.pokemon.displayName || wild.pokemon.name, pokedexId: wild.pokemon.pokedexId, level: wild.pokemon.level, hp: wild.pokemon.hp, maxHp: wild.pokemon.maxHp, imageUrl: wild.pokemon.imageUrl, imageLocalPath: wild.pokemon.imageLocalPath, shiny: Boolean(wild.pokemon.shiny), primaryType: wild.pokemon.primaryType },
        player: { name: lead.displayName || lead.name, pokedexId: lead.pokedexId, level: lead.level, hp: lead.hp, maxHp: lead.maxHp, imageUrl: lead.backImageUrl || lead.imageUrl, shiny: lead.shiny, trainer: battle.challengerTrainer },
        round: 1,
        arenaId: battle.arenaId,
        weather: battle.weather,
        statusText: `${lead.displayName || lead.name} vs Wild ${wild.pokemon.displayName || wild.pokemon.name}!`,
      });
    } catch {}

    const playerName = lead.displayName || lead.name;
    const wildName = wild.pokemon.displayName || wild.pokemon.name;
    const playerType = lead.primaryType || (lead.types || [])[0] || "???";
    const wildType = wild.pokemon.primaryType || (wild.pokemon.types || [])[0] || "???";
    const prettyType = (type) => String(type).replace(/^./, (char) => char.toUpperCase());
    const playerTypeEmoji = TYPE_EMOJIS[playerType.toLowerCase()] || "⭐";
    const wildTypeEmoji = TYPE_EMOJIS[wildType.toLowerCase()] || "⭐";
    const playerMoves = (lead.moves || []).length;
    const wildMoves = (wild.pokemon.moves || []).length;
    const caption =
`⚔️ Your Turn! ⚔️

@${sender.split("@")[0]}'s ${playerTypeEmoji} ${playerName}
❤️ ${lead.hp}/${lead.maxHp} • ⭐ Lv.${lead.level} • 🎯 ${playerMoves} Moves • ${playerTypeEmoji} ${prettyType(playerType)}

🆚

${wildTypeEmoji} Wild ${wildName}
❤️ ${wild.pokemon.hp}/${wild.pokemon.maxHp} • ⭐ Lv.${wild.pokemon.level} • 🎯 ${wildMoves} Moves • ${wildTypeEmoji} ${prettyType(wildType)}

━━━━━━━━━━━━━━━━━━━━

⚔️ Fight → \`.battle fight <1-6>\`
🎒 Bag → \`.battle items\`
🔄 Switch → \`.battle switch\`
🔴 Pokéball → \`.battle pokeball (type)\`
🏃 Run → \`.battle run\``;

    if (sceneBuffer) {
      await sock.sendMessage(jid, { image: sceneBuffer, caption, mentions: [sender] }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, { text: caption, mentions: [sender] }, { quoted: msg });
    }
  },
};
