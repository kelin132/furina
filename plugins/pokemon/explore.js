import { getTrainer, pickLeadFromParty, claimPokemonExploration } from "../../lib/pokemon/players.mjs";
import { getTrainerParty } from "../../lib/pokemon/pokemonDb.mjs";
import { getBattle, startWildBattle } from "../../lib/pokemon/battleState.mjs";
import { hasWild, setWild } from "../../lib/pokemon/wildState.mjs";
import { generateBattleScene } from "../../lib/pokemon/canvas.mjs";
import { POKEMON_DESTINATIONS, resolvePokemonDestination, createFusionPokemon } from "../../lib/pokemon/exploration.mjs";
import { readPokemonAnimation, readPokemonMapImage } from "../../lib/pokemon/media.mjs";


const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatCooldown(ms) {
  const totalMinutes = Math.ceil(Math.max(0, ms) / 60000);
  return Math.floor(totalMinutes / 60) + "h " + (totalMinutes % 60) + "m";
}

function locationList() {
  return POKEMON_DESTINATIONS.map((destination, index) => (index + 1) + ". " + destination.name).join("\n");
}

export default {
  name: "explore",
  aliases: ["map", "adventure"],
  description: "View the exploration map or explore a destination",
  category: "pokemon",
  usage: ".map | .explore <place>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    if (!jid) return;
    const query = args.join(" ").trim();

    if (!query || query.toLowerCase() === "map" || query.toLowerCase() === "menu") {
      const caption = "🗺️ *AIDORU EXPLORATION MAP*\n\n" + locationList() +
        "\n\nChoose a place with .explore <place> or its number. Fused Pokémon are powerful, cannot be caught, and exploring has a 6-hour cooldown.";
      try {
        const map = await readPokemonMapImage();
        return sock.sendMessage(jid, { image: map, caption }, { quoted: msg });
      } catch {
        return sock.sendMessage(jid, { text: caption }, { quoted: msg });
      }
    }

    const destination = resolvePokemonDestination(query);
    if (!destination) {
      return sock.sendMessage(jid, {
        text: "❌ Unknown place. Available places:\n" + locationList() + "\nUse .map to see the map.",
      }, { quoted: msg });
    }
    if (getBattle(jid) || hasWild(jid)) {
      return sock.sendMessage(jid, { text: "⚔️ Finish the current Pokémon encounter before exploring again." }, { quoted: msg });
    }

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, { text: "❌ Start your journey first with .startjourney." }, { quoted: msg });
    }
    const party = await getTrainerParty(sender);
    if (!party?.length) {
      return sock.sendMessage(jid, { text: "❌ Your party is empty. Add a Pokémon before exploring." }, { quoted: msg });
    }
    const lead = pickLeadFromParty(trainer, party);
    if (!lead || lead.hp <= 0) {
      return sock.sendMessage(jid, { text: "💔 Your party has no healthy Pokémon. Heal before exploring." }, { quoted: msg });
    }

    const cooldown = await claimPokemonExploration(sender);
    if (!cooldown.ok) {
      if (cooldown.notFound) {
        return sock.sendMessage(jid, { text: "❌ Start your journey first with .startjourney." }, { quoted: msg });
      }
      return sock.sendMessage(jid, {
        text: "⏳ You can explore again in " + formatCooldown(cooldown.remainingMs) + ".",
      }, { quoted: msg });
    }

    const actor = msg.discordChannelId
      ? "@" + (msg.pushName || String(sender).replace(/^discord:/, "").split("@")[0])
      : "@" + String(sender).split("@")[0];
    const travelCaption = actor + " is travelling to explore " + destination.name + "…";
    try {
      const walkingAnimation = await readPokemonAnimation("explore-walk");
      await sock.sendMessage(jid, {
        video: walkingAnimation,
        mimetype: "video/mp4",
        fileName: "explore-walk.mp4",
        gifPlayback: true,
        caption: travelCaption,
        ...(!msg.discordChannelId ? { mentions: [sender] } : {}),
      }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, {
        text: travelCaption,
        ...(!msg.discordChannelId ? { mentions: [sender] } : {}),
      }, { quoted: msg });
    }

    await sleep(1400);
    await sock.sendMessage(jid, { text: "🔎 Exploring " + destination.name + "…" }, { quoted: msg });
    await sleep(1200);

    const boss = createFusionPokemon(destination);
    setWild(jid, boss, sender);
    const battle = startWildBattle(jid, {
      jid: sender,
      username: trainer.username || msg.pushName || "Trainer",
      pokemon: lead,
    }, boss);

    let sceneBuffer;
    try {
      sceneBuffer = await generateBattleScene({
        enemy: {
          name: boss.displayName,
          pokedexId: 0,
          level: boss.level,
          hp: boss.hp,
          maxHp: boss.maxHp,
          imageUrl: boss.imageUrl,
          imageLocalPath: boss.imageLocalPath,
          primaryType: boss.primaryType,
          shiny: false,
        },
        player: {
          name: lead.displayName || lead.name,
          pokedexId: lead.pokedexId,
          level: lead.level,
          hp: lead.hp,
          maxHp: lead.maxHp,
          imageUrl: lead.backImageUrl || lead.imageUrl,
          fallbackImageUrl: lead.imageUrl,
          shiny: lead.shiny,
          trainer: battle?.challengerTrainer,
        },
        round: 1,
        statusText: boss.displayName + " appeared at " + destination.name + "!",
      });
    } catch {}

    const playerLabel = msg.discordChannelId ? (msg.pushName || "Trainer") : actor;
    const moves = boss.moves.map((move, index) => (index + 1) + ". " + move.name).join(" • ");
    const caption = "⚔️ *A fused Pokémon appeared at " + destination.name + "!*\n\n" +
      playerLabel + "'s " + (lead.displayName || lead.name) + " (Lv." + lead.level + ")\n" +
      "🆚 " + boss.displayName + " (Lv." + boss.level + ")\n" +
      "❤️ " + boss.hp + "/" + boss.maxHp + "  •  🛡️ Fusion shield " + boss.shieldCharges + "/" + boss.maxShieldCharges + "\n" +
      "Special moves: " + moves + "\n\n" +
      "Use .battle fight <1-4>, .battle switch, or .battle run. This fused Pokémon cannot be caught.";
    const battleComponents = {};
    const mentions = msg.discordChannelId ? [] : [sender];
    if (sceneBuffer) {
      return sock.sendMessage(jid, { image: sceneBuffer, caption, mentions, ...battleComponents }, { quoted: msg });
    }
    return sock.sendMessage(jid, { text: caption, mentions, ...battleComponents }, { quoted: msg });
  },
};
