import { getTrainer, pickLeadFromParty, addItem } from "../../lib/pokemon/players.mjs";
import { getTrainerParty, updatePokemon, addPokemonXP } from "../../lib/pokemon/pokemonDb.mjs";
import { getBattle } from "../../lib/pokemon/battleState.mjs";
import { POKEMON_DESTINATIONS, resolvePokemonDestination, createFusionPokemon } from "../../lib/pokemon/exploration.mjs";
import { getActivePokemonRaid, startPokemonRaid, joinPokemonRaid, attackPokemonRaid, claimPokemonRaidReward } from "../../lib/pokemon/raidState.mjs";
import { recordDailyProgress } from "../../lib/pokemon/progression.mjs";
import { addMoney } from "../economy/database.js";

const cooldownText = (ms) => {
  const minutes = Math.ceil(Math.max(0, ms) / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

async function claimRaidRewards(sock, jid, msg, raid) {
  const rewarded = [];
  const cooldown = [];
  for (const participant of raid.participants) {
    await recordDailyProgress(participant.jid, "raid")
      .catch((error) => console.error("[pokemon research] Progress recording failed:", error?.message || error));
    if (!await claimPokemonRaidReward(raid._id, participant.jid)) {
      cooldown.push(participant.name);
      continue;
    }
    await addMoney(participant.jid, 500000);
    await addItem(participant.jid, "ultraball", 1);
    await addPokemonXP(participant.pokemonId, 3000);
    rewarded.push(participant.name);
  }
  if (rewarded.length || cooldown.length) {
    await sock.sendMessage(jid, {
      text: [
        rewarded.length ? `Raid cleared! ${rewarded.join(", ")} earned $500,000, 3,000 Pokémon XP, and 1 Ultra Ball each.` : "Raid cleared!",
        cooldown.length ? `Raid rewards are limited to once every 12 hours; no reward this time for ${cooldown.join(", ")}.` : "",
      ].filter(Boolean).join("\n"),
    }, { quoted: msg });
  }
}

export default {
  name: "raid",
  aliases: ["praids"],
  description: "Join friends to defeat a fused Pokémon raid boss",
  category: "pokemon",
  usage: ".raid start [place] | join | status | attack <move>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const action = String(args[0] || "status").toLowerCase();
    if (action === "start") {
      if (getBattle(jid)) return sock.sendMessage(jid, { text: "Finish the current battle before starting a raid." }, { quoted: msg });
      const placeQuery = args.slice(1).join(" ");
      const destination = placeQuery
        ? resolvePokemonDestination(placeQuery)
        : POKEMON_DESTINATIONS[Math.floor(Math.random() * POKEMON_DESTINATIONS.length)];
      if (!destination) {
        return sock.sendMessage(jid, { text: `Choose one of these places: ${POKEMON_DESTINATIONS.map((place) => place.name).join(", ")}.` }, { quoted: msg });
      }
      const boss = createFusionPokemon(destination);
      const result = await startPokemonRaid(jid, destination, boss);
      if (!result.ok) {
        return sock.sendMessage(jid, { text: `A raid against ${result.existing.boss.name} is already active here. Use .raid join.` }, { quoted: msg });
      }
      return sock.sendMessage(jid, {
        text: `A co-op raid began at ${destination.name}!\n${boss.displayName} · Lv.${boss.level} · ${boss.hp.toLocaleString()} HP · ${boss.shieldCharges} shield charges\nUp to four trainers can join with .raid join. The starter Pokémon cannot be caught.`,
      }, { quoted: msg });
    }

    if (action === "join") {
      if (getBattle(jid)) return sock.sendMessage(jid, { text: "Finish your current battle before joining a raid." }, { quoted: msg });
      const trainer = await getTrainer(sender);
      if (!trainer) return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });
      const lastReward = trainer.lastRaidRewardAt ? new Date(trainer.lastRaidRewardAt).getTime() : 0;
      const remaining = 12 * 60 * 60 * 1000 - (Date.now() - lastReward);
      if (lastReward > 0 && remaining > 0) {
        return sock.sendMessage(jid, { text: `Your next raid reward is available in ${cooldownText(remaining)}.` }, { quoted: msg });
      }
      const party = await getTrainerParty(sender);
      const lead = pickLeadFromParty(trainer, party);
      if (!lead || Number(lead.hp) <= 0) return sock.sendMessage(jid, { text: "You need a healthy party Pokémon to join a raid." }, { quoted: msg });
      const joined = await joinPokemonRaid(jid, {
        jid: sender,
        name: trainer.username || msg.pushName || "Trainer",
        pokemonId: lead._id,
        pokemonName: lead.nickname || lead.displayName || lead.name,
        pokemon: lead,
      });
      if (!joined.ok) {
        const text = joined.missing ? "There isn't an active raid here. Start one with .raid start [place]."
          : joined.full ? "This raid already has four trainers."
            : joined.alreadyJoined ? "You're already in this raid."
              : "The raid is busy. Try joining again.";
        return sock.sendMessage(jid, { text }, { quoted: msg });
      }
      const moves = lead.moves.map((move, index) => `${index + 1}. ${move.name}`).join("\n");
      return sock.sendMessage(jid, {
        text: `${trainer.username || "Trainer"} joined the raid with ${lead.nickname || lead.displayName || lead.name} (Lv.${lead.level}).\nUse .raid attack <move number> to attack.\n${moves}`,
      }, { quoted: msg });
    }

    if (action === "attack" || action === "hit") {
      if (getBattle(jid)) return sock.sendMessage(jid, { text: "Finish your current battle before attacking in a raid." }, { quoted: msg });
      const moveNumber = Number(args[1]);
      const result = await attackPokemonRaid(jid, sender, moveNumber - 1);
      if (!result.ok) {
        const text = result.missing ? "There isn't an active raid here."
          : result.notJoined ? "Join the raid first with .raid join."
            : result.fainted ? "Your raid Pokémon fainted. Use .raid join to send your next healthy party Pokémon."
              : result.invalidMove ? `Choose a move from 1 to ${result.moveCount}.`
                : result.cooldown ? `Catch your breath for ${cooldownText(result.cooldown)} before attacking again.`
                  : "The raid is resolving another action. Try again.";
        return sock.sendMessage(jid, { text }, { quoted: msg });
      }

      const participant = result.raid.participants.find((entry) => entry.jid === String(sender));
      if (participant?.pokemonId) await updatePokemon(participant.pokemonId, { hp: result.playerHp });
      let text = `${participant?.name || "Trainer"} dealt ${result.damage} damage to ${result.raid.boss.name}.`;
      if (result.counterMove) {
        text += `\n${result.raid.boss.name} countered with ${result.counterMove.name} for ${result.counterDamage} damage.`;
      }
      text += `\nBoss HP: ${result.raid.boss.hp.toLocaleString()}/${result.raid.boss.maxHp.toLocaleString()} · Shield: ${result.raid.boss.shieldCharges}/${result.raid.boss.maxShieldCharges}`;
      if (result.playerHp <= 0) text += "\nYour Pokémon fainted. Join again with another healthy party Pokémon.";
      await sock.sendMessage(jid, { text }, { quoted: msg });
      if (result.defeated) await claimRaidRewards(sock, jid, msg, result.raid);
      return;
    }

    if (action === "status") {
      const raid = await getActivePokemonRaid(jid);
      if (!raid) return sock.sendMessage(jid, { text: "No active raid here. Start one with .raid start [place]." }, { quoted: msg });
      const team = raid.participants.map((entry) => `${entry.name}: ${entry.pokemonName} Lv.${entry.level} · ${entry.hp}/${entry.maxHp} HP`).join("\n");
      const moves = raid.boss.moves.map((move) => move.name).join(", ");
      return sock.sendMessage(jid, {
        text: `Raid at ${raid.place}\n${raid.boss.name} Lv.${raid.boss.level}\nHP ${raid.boss.hp.toLocaleString()}/${raid.boss.maxHp.toLocaleString()} · Shield ${raid.boss.shieldCharges}/${raid.boss.maxShieldCharges}\nBoss moves: ${moves}\n\n${team || "No trainers have joined yet."}`,
      }, { quoted: msg });
    }

    return sock.sendMessage(jid, {
      text: "Raid commands:\n.raid start [place]\n.raid join\n.raid attack <move>\n.raid status",
    }, { quoted: msg });
  },
};
