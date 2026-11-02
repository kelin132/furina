// .item use <item> — use Pokémon items outside battle

import { getTrainer, hasItem, removeItem, updateTrainer } from "../../lib/pokemon/players.mjs";
import {
  addPokemonXP,
  getAllTrainerPokemon,
  getPokemonXpNeeded,
  MAX_POKEMON_LEVEL,
  evolvePokemon,
} from "../../lib/pokemon/pokemonDb.mjs";
import { getLevelEvolution, getLearnableMoveAtLevel, TYPE_EMOJIS } from "../../lib/pokemon/gameLogic.mjs";
import { setPendingLearn } from "../../lib/pokemon/moveLearnState.mjs";
import { fetchPokemon } from "../../lib/pokemon/api.mjs";
import { endBattle, getBattle } from "../../lib/pokemon/battleState.mjs";
import { clearWild } from "../../lib/pokemon/wildState.mjs";
import { setRepel } from "../../lib/pokemon/itemState.mjs";

const REPEL_ITEMS = {
  repel:     { label: "Repel",       durationMs: 100 * 60 * 1000 },
  superrepel:{ label: "Super Repel", durationMs: 200 * 60 * 1000 },
  maxrepel:  { label: "Max Repel",   durationMs: 250 * 60 * 1000 },
};

function normalize(value) {
  return value.toLowerCase().replace(/\s+/g, "");
}

function findPokemon(pokemon, query) {
  const normalized = query.toLowerCase().trim();
  return pokemon.find((entry) =>
    entry.name?.toLowerCase() === normalized ||
    entry.displayName?.toLowerCase() === normalized ||
    entry.nickname?.toLowerCase() === normalized ||
    entry._id?.toString() === normalized
  );
}

export default {
  name: "item",
  aliases: ["pokemonitem"],
  description: "Use a Pokémon item from your bag",
  category: "pokemon",
  usage: ".item use <item> [pokémon]",
  cooldown: 5,

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    if ((args[0] || "").toLowerCase() !== "use" || !args[1]) {
      return reply(
        "Usage: *.item use <item> [pokémon]*\n\n" +
        "Key items:\n" +
        "• *.item use repel*\n" +
        "• *.item use superrepel*\n" +
        "• *.item use maxrepel*\n" +
        "• *.item use escaperope*\n" +
        "• *.item use rarecandy <pokémon>*\n\n" +
        "💎 Key Stone is equipped with *.equip <pokémon>*."
      );
    }

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return reply("❌ Start your journey first! Use *.startjourney*");
    }

    const itemKey = normalize(args[1]);
    if (!(await hasItem(sender, itemKey))) {
      return reply(`❌ You don't have a *${itemKey}* in your Pokémon bag.\nUse *.bag* to check your items.`);
    }

    if (itemKey === "keystone") {
      return reply("💎 Key Stone is equipped, not consumed.\nUse *.equip <pokémon>* to attach it.");
    }

    const repel = REPEL_ITEMS[itemKey];
    if (repel) {
      const expiresAt = setRepel(jid, itemKey, repel.durationMs);
      await removeItem(sender, itemKey);
      const minutes = Math.round(repel.durationMs / 60_000);
      return reply(
        `🌿 *${repel.label} activated!*\n\n` +
        `Wild Pokémon encounters are blocked for *${minutes} minutes*.\n` +
        `⏰ Expires in: *${new Date(expiresAt).toLocaleTimeString()}*`
      );
    }

    if (itemKey === "escaperope") {
      const battle = getBattle(jid);
      if (!battle || (battle.challengerJid !== sender && battle.opponentJid !== sender)) {
        return reply("❌ Escape Rope can only be used during your active Pokémon battle.");
      }
      await removeItem(sender, itemKey);
      endBattle(jid);
      if (battle.type === "wild") clearWild(jid);
      return reply("🪢 *Escape Rope used!*\nYou safely fled from the Pokémon battle.");
    }

    if (itemKey === "rarecandy") {
      // Five Rare Candy uses per trainer per day, resetting at midnight UTC.
      const DAILY_LIMIT = 5;
      const today = new Date().toISOString().slice(0, 10);
      const lastDate = trainer.rareCandyLastDate || "";
      const usesToday = lastDate === today ? (trainer.rareCandyUsesToday || 0) : 0;
      if (usesToday >= DAILY_LIMIT) {
        return reply(`❌ *Daily limit reached!*\n\nYou can only use *${DAILY_LIMIT} Rare Candies per day*.\n⏳ Resets at midnight.`);
      }

      const pokemonQuery = args.slice(2).join(" ").trim();
      if (!pokemonQuery) {
        return reply(`❌ Choose a Pokémon.\nExample: *.item use rarecandy pikachu*\n\n🍬 Uses today: *${usesToday}/${DAILY_LIMIT}*`);
      }

      const pokemon = findPokemon(await getAllTrainerPokemon(sender), pokemonQuery);
      if (!pokemon) {
        return reply(`❌ You don't have a Pokémon named *${pokemonQuery}*.\nUse *.party* or *.pc* to see your Pokémon.`);
      }
      if ((pokemon.level || 1) >= MAX_POKEMON_LEVEL) {
        return reply(`❌ *${pokemon.displayName || pokemon.name}* is already at the maximum level.`);
      }

      const result = await addPokemonXP(pokemon._id, getPokemonXpNeeded(pokemon.level));
      if (!result?.leveledUp) {
        return reply("❌ Rare Candy could not be applied. Try again.");
      }

      await removeItem(sender, itemKey);
      await updateTrainer(sender, { rareCandyLastDate: today, rareCandyUsesToday: usesToday + 1 });
      let replyText =
        `🍬 *Rare Candy used!*\n\n` +
        `🐾 ${pokemon.displayName || pokemon.name}: ` +
        `Lv.${pokemon.level} → *Lv.${result.newLevel}*`;

      // Check for level-based evolution after leveling up
      const evoTarget = getLevelEvolution(pokemon.name, result.newLevel);
      if (evoTarget) {
        try {
          const newApiData = await fetchPokemon(evoTarget);
          const evolved    = await evolvePokemon(pokemon._id, newApiData);
          if (evolved) {
            const beforeName = pokemon.displayName || pokemon.name;
            const afterName  = evolved.displayName || evolved.name;
            replyText += `\n\n✨ *WHAT?! ${beforeName.toUpperCase()} IS EVOLVING!*\n🌟 *${beforeName}* → *${afterName}*! 🎉`;
          }
        } catch {
          // evolution fetch failed silently — level-up message still shown
        }
      }

      await reply(replyText);

      // ── Move-learn check (same logic as after battle level-ups) ──────────────
      const leveledPokemon = result.pokemon;
      const newMove = getLearnableMoveAtLevel(
        leveledPokemon.primaryType,
        result.newLevel,
        leveledPokemon.moves || [],
        leveledPokemon.types || [],
      );
      if (newMove) {
        const currentMoves = leveledPokemon.moves || [];
        setPendingLearn(sender, {
          pokemonId:   (leveledPokemon._id || leveledPokemon.id)?.toString(),
          pokemonName: leveledPokemon.displayName || leveledPokemon.name,
          newMove,
          currentMoves,
          chatId: jid,
        });

        const newEmoji    = TYPE_EMOJIS[newMove.type] || "⭐";
        const currentList = currentMoves.map((m, i) => {
          const e = TYPE_EMOJIS[m.type] || "⭐";
          return `  *${i + 1}.* ${e} ${m.name} (Power: ${m.power || "—"})`;
        }).join("\n");

        await reply(
`🌟 *${leveledPokemon.displayName || leveledPokemon.name} wants to learn a new move!*

${newEmoji} *${newMove.name}* (Power: ${newMove.power || "—"}, Type: ${newMove.type})
${newMove.desc ? `📖 ${newMove.desc}` : ""}

*Current moves:*
${currentList}

${currentMoves.length >= 6
  ? `❗ Already knows 6 moves. Replace one?\nReply *.learnmove <1-6>* to replace, or *.learnmove cancel* to skip.`
  : `Reply *.learnmove yes* to learn *${newMove.name}*!`}`
        );
      }

      return;
    }

    return reply(
      `❌ *${itemKey}* cannot be used with *.item use*.\n\n` +
      "Use *.battle item* for battle items, *.evolve* for evolution stones, or *.equip* for Key Stone."
    );
  },
};