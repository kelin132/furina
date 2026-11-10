// plugins/pokemon/battle.js
// Handles all battle subcommands: fight, run, item, pokeball, switch

import { getBattle, updateBattle, endBattle, isMyTurn, claimBattleReward } from "../../lib/pokemon/battleState.mjs";
import { clearWild, updateWildHp } from "../../lib/pokemon/wildState.mjs";
import { getTrainer, removeItem, addItem, recordDailyPokemonWildWin } from "../../lib/pokemon/players.mjs";
import { addMoney } from "../economy/database.js";
import { updatePokemon, addPokemonXP, buildPokemon, savePokemon, getTrainerParty, getPokemonXpNeeded, evolvePokemon } from "../../lib/pokemon/pokemonDb.mjs";
import { addToParty, addToPC, updateTrainer } from "../../lib/pokemon/players.mjs";
import { calcDamage, tryCatch, xpReward, pvpXpReward, coinReward, getMovesForType, getLearnableMoveAtLevel, getLevelEvolution, TYPE_EMOJIS, TYPE_MOVES, getTypeEffectiveness, effectivenessText } from "../../lib/pokemon/gameLogic.mjs";
import { generateBattleScene, generateBattleResult } from "../../lib/pokemon/canvas.mjs";
import { fetchPokemon } from "../../lib/pokemon/api.mjs";
import { setPendingLearn } from "../../lib/pokemon/moveLearnState.mjs";
import { MART_ITEMS } from "../../lib/pokemon/martItems.mjs";
import { applyBattleItem, BATTLE_ITEM_EFFECTS } from "../../lib/pokemon/battleItems.mjs";
import { readPokemonAnimation } from "../../lib/pokemon/media.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DELAY = 3000; // 3-second delay between messages

async function sendScene(sock, jid, msg, battle, statusText, hitSide, damage, crit, mentions = []) {
  try {
    const buf = await generateBattleScene({
      player: {
        name: battle.challengerPokemon.displayName || battle.challengerPokemon.name,
        level: battle.challengerPokemon.level,
        hp: battle.challengerPokemon.hp,
        maxHp: battle.challengerPokemon.maxHp,
        pokedexId: battle.challengerPokemon.pokedexId,
        // Pass both so the canvas can fall back from back-sprite → front-sprite
        // (special forms like Necrozma-ultra lack back sprites on the CDN)
        imageUrl: battle.challengerPokemon.backImageUrl || battle.challengerPokemon.imageUrl,
        fallbackImageUrl: battle.challengerPokemon.imageUrl,
        shiny: battle.challengerPokemon.shiny,
        primaryType: battle.challengerPokemon.primaryType || (battle.challengerPokemon.types || [])[0],
        trainer: battle.challengerTrainer,
      },
      enemy: {
        name: battle.opponentPokemon.displayName || battle.opponentPokemon.name,
        level: battle.opponentPokemon.level,
        hp: battle.opponentPokemon.hp,
        maxHp: battle.opponentPokemon.maxHp,
        pokedexId: battle.opponentPokemon.pokedexId,
        imageUrl: battle.opponentPokemon.imageUrl,
        imageLocalPath: battle.opponentPokemon.imageLocalPath,
        shiny: battle.opponentPokemon.shiny,
        trainer: battle.opponentTrainer,
      },
      round: battle.round,
      arenaId: battle.arenaId || "meadow",
      weather: battle.weather,
      hitSide, damage, crit, statusText,
    });
    await sock.sendMessage(jid, { image: buf, caption: statusText, mentions }, { quoted: msg });
    return true;
  } catch {
    await sock.sendMessage(jid, { text: statusText, mentions }, { quoted: msg });
    return false;
  }
}

/** Show the current battle status and whose turn it is. */
async function sendBattlePrompt(sock, jid, msg, myPokemon, enemyPokemon, battleType, trainerJid = null, turnName = null) {
  const myName    = myPokemon.displayName    || myPokemon.name;
  const enemyName = enemyPokemon.displayName || enemyPokemon.name;
  const isWild    = battleType === "wild";

  const myType     = myPokemon.primaryType    || (myPokemon.types    || [])[0] || "???";
  const enemyType  = enemyPokemon.primaryType || (enemyPokemon.types || [])[0] || "???";
  const myTypeEmoji    = TYPE_EMOJIS[myType?.toLowerCase()]    || "⭐";
  const enemyTypeEmoji = TYPE_EMOJIS[enemyType?.toLowerCase()] || "⭐";
  const myMovesCt  = (myPokemon.moves    || []).length;
  const enmMovesCt = (enemyPokemon.moves || []).length;
  const prettyType = (type) => String(type || "???").replace(/^./, (char) => char.toUpperCase());

  const trainerNum  = trainerJid ? trainerJid.split("@")[0] : null;
  const trainerLabel = trainerNum ? `@${trainerNum}` : (turnName || "Trainer");
  const myLine = `${trainerLabel}'s ${myTypeEmoji} ${myName}
❤️ ${myPokemon.hp}/${myPokemon.maxHp} • ⭐ Lv.${myPokemon.level} • 🎯 ${myMovesCt} Moves • ${myTypeEmoji} ${prettyType(myType)}`;

  const enemyLabel = isWild ? `Wild` : `Opponent`;
  const enemyLine  = `${enemyTypeEmoji} ${enemyLabel} ${enemyName}
❤️ ${enemyPokemon.hp}/${enemyPokemon.maxHp} • ⭐ Lv.${enemyPokemon.level} • 🎯 ${enmMovesCt} Moves • ${enemyTypeEmoji} ${prettyType(enemyType)}`;

  const ballLine  = isWild ? `\n🔴 Pokéball → \`.battle pokeball (type)\`` : "";
  const mentions  = trainerJid ? [trainerJid] : [];

  await sock.sendMessage(jid, {
    text:
`⚔️ Your Turn! ⚔️

${myLine}

🆚

${enemyLine}${enemyPokemon.isFusionBoss ? "\n🛡️ Fusion shield: " + (enemyPokemon.shieldCharges || 0) + "/" + (enemyPokemon.maxShieldCharges || 3) + " charges" : ""}

━━━━━━━━━━━━━━━━━━━━

⚔️ Fight → \`.battle fight <1-6>\`
🎒 Bag → \`.battle items\`
🔄 Switch → \`.battle switch\`${ballLine}
🏃 Run → \`.battle run\``,
    mentions,
  }, { quoted: msg });
}

/** Show the current PvP state from the next player's point of view. */
async function sendNextPvPPrompt(sock, jid, msg, battle) {
  const nextIsChallenger = battle.turn === "challenger";
  const nextPokemon  = nextIsChallenger ? battle.challengerPokemon : battle.opponentPokemon;
  const nextEnemy    = nextIsChallenger ? battle.opponentPokemon   : battle.challengerPokemon;
  const nextName     = nextIsChallenger ? battle.challengerName    : battle.opponentName;
  const nextJid      = nextIsChallenger ? battle.challengerJid     : battle.opponentJid;

  await sendBattlePrompt(sock, jid, msg, nextPokemon, nextEnemy, "pvp", nextJid, nextName);
}

/** Format the move list with descriptions and command hints for display */
function formatMoveList(moves) {
  return moves.map((m, i) => {
    const emoji = TYPE_EMOJIS[m.type] || "⭐";
    const power = m.power ? `Power: ${m.power}` : "Status";
    const desc  = m.desc ? `\n   📖 *What it does:* ${m.desc}` : "";
    return `*${i + 1}.* ${emoji} *${m.name}* (${power}, PP: ${m.pp})${desc}\n   ➤ Use \`.battle fight ${i + 1}\``;
  }).join("\n\n");
}

/** Check for a learnable move after level-up and prompt the trainer */
async function checkMoveLearn(sock, jid, msg, trainerJid, pokemonResult) {
  if (!pokemonResult?.leveledUp) return;

  const { newLevel, pokemon } = pokemonResult;
  const pokemon_name = pokemon.displayName || pokemon.name;
  const newMove = getLearnableMoveAtLevel(pokemon.primaryType, newLevel, pokemon.moves || [], pokemon.types || []);
  if (!newMove) return;

  const currentMoves = pokemon.moves || [];
  const moveId = pokemon._id?.toString() || pokemon.id?.toString();

  setPendingLearn(trainerJid, {
    pokemonId: moveId,
    pokemonName: pokemon_name,
    newMove,
    currentMoves,
    chatId: jid,
  });

  const newEmoji  = TYPE_EMOJIS[newMove.type] || "⭐";
  const currentList = currentMoves.map((m, i) => {
    const e = TYPE_EMOJIS[m.type] || "⭐";
    return `  *${i + 1}.* ${e} ${m.name} (Power: ${m.power || "—"})`;
  }).join("\n");

  await sock.sendMessage(jid, {
    text:
`🌟 *${pokemon_name.toUpperCase()} wants to learn a new move!*

${newEmoji} *${newMove.name}* (Power: ${newMove.power || "—"}, Type: ${newMove.type})
${newMove.desc ? `📖 ${newMove.desc}` : ""}

*Current moves:*
${currentList}

${currentMoves.length >= 6
  ? `❗ ${pokemon_name} already knows 6 moves. Replace one?\nReply *.learnmove <1-6>* to replace a move with *${newMove.name}*\nOr *.learnmove skip* to skip this move.`
  : `Reply *.learnmove yes* to learn *${newMove.name}*!`}`,
  }, { quoted: msg });
}

// ── Wild battle helpers ───────────────────────────────────────────────────────

async function handleWildDefeat(sock, jid, msg, battle, trainer) {
  const myPokemon  = battle.challengerPokemon;
  const wildPokemon = battle.opponentPokemon;
  const trainerName = trainer?.username || msg.pushName || "Trainer";
  const myPokeName  = myPokemon.displayName || myPokemon.name;
  const pokeId      = myPokemon._id || myPokemon.id;

  if (wildPokemon.isFusionBoss) {
    if (!claimBattleReward(jid)) return;
    await recordDailyPokemonWildWin(battle.challengerJid).catch((error) =>
      console.error("Daily Pokémon quest progress failed:", error),
    );
    const bossXp = 30000;
    const bossGold = 12000000;
    if (pokeId) await addPokemonXP(pokeId, bossXp);
    await addMoney(battle.challengerJid, bossGold);
    await addItem(battle.challengerJid, "ultraball", 12);
    endBattle(jid);
    clearWild(jid);
    return sock.sendMessage(jid, {
      text: "🏆 " + wildPokemon.displayName + " was defeated! You gained 30,000 XP, $12,000,000, and 12 Ultra Balls.",
    }, { quoted: msg });
  }

  const xp    = xpReward(wildPokemon);
  const coins = coinReward(wildPokemon.level);

  await recordDailyPokemonWildWin(battle.challengerJid).catch((error) =>
    console.error("Daily Pokémon quest progress failed:", error),
  );
  const xpRes = await addPokemonXP(pokeId, xp);
  await addMoney(battle.challengerJid, coins);

  endBattle(jid);
  clearWild(jid);

  let resultText =
`🏆 *Wild ${wildPokemon.displayName || wildPokemon.name} was defeated!*

🐉 *${trainerName}'s ${myPokeName}* won the battle!
✨ +${xp} XP  💰 +${coins} coins`;

  if (xpRes?.leveledUp) {
    resultText += `\n🎉 *${myPokeName} leveled up! Now Lv.${xpRes.newLevel}!*`;

    // ── Auto-evolve on level up ─────────────────────────────────────────────
    const evoTarget = getLevelEvolution(battle.challengerPokemon.name, xpRes.newLevel);
    if (evoTarget) {
      try {
        const newApiData  = await fetchPokemon(evoTarget);
        const evolved     = await evolvePokemon(pokeId, newApiData);
        if (evolved) {
          const evolvedName = evolved.displayName || evolved.name;
          resultText += `\n\n✨ *WHAT?! ${myPokeName.toUpperCase()} IS EVOLVING!*\n🌟 *${myPokeName}* → *${evolvedName}*! 🎉`;
        }
      } catch {}
    }
  }

  try {
    const buf = await generateBattleResult({
      winner: { name: myPokeName, imageUrl: battle.challengerPokemon.imageUrl || battle.challengerPokemon.backImageUrl },
      loser:  { name: wildPokemon.displayName || wildPokemon.name, imageUrl: wildPokemon.imageUrl },
      rewardText: `+${xp} XP`,
    });
    await sock.sendMessage(jid, { image: buf, caption: resultText }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, { text: resultText }, { quoted: msg });
  }

  await checkMoveLearn(sock, jid, msg, battle.challengerJid, xpRes);
}

/**
 * Handle a PvP battle where one player's Pokémon just fainted.
 *
 * FIX: Before ending the battle, check whether the loser still has alive
 * Pokémon. If they do, keep the battle going and ask them to send one out.
 * Only award rewards and declare a winner once they are truly out of Pokémon.
 */
async function handlePvPDefeat(sock, jid, msg, battle, loserJid) {
  const isLoserChallenger = loserJid === battle.challengerJid;

  const loser = isLoserChallenger
    ? { jid: battle.challengerJid, name: battle.challengerName, pokemon: battle.challengerPokemon }
    : { jid: battle.opponentJid,   name: battle.opponentName,   pokemon: battle.opponentPokemon };
  const winner = isLoserChallenger
    ? { jid: battle.opponentJid,   name: battle.opponentName,   pokemon: battle.opponentPokemon }
    : { jid: battle.challengerJid, name: battle.challengerName, pokemon: battle.challengerPokemon };

  // Award XP for every opposing Pokémon that faints, not only when the
  // opponent's whole party has been defeated. The reward is based on the
  // level of the Pokémon that just fainted.
  // Persist winner's current HP before awarding XP so addPokemonXP reads
  // the battle-state HP (possibly reduced by hits taken) rather than the
  // stale pre-battle value still sitting in the DB.
  if (winner.pokemon._id) {
    await updatePokemon(winner.pokemon._id, { hp: winner.pokemon.hp }).catch(() => {});
  }

  const xp       = pvpXpReward(winner.pokemon, loser.pokemon);
  const winnerId = winner.pokemon._id || winner.pokemon.id;
  const xpRes    = await addPokemonXP(winnerId, xp);
  const rewardedWinnerPokemon = xpRes?.pokemon
    ? { ...winner.pokemon, ...xpRes.pokemon }
    : winner.pokemon;
  const winnerPokemonKey = isLoserChallenger ? "opponentPokemon" : "challengerPokemon";
  const loserPokemonKey  = isLoserChallenger ? "challengerPokemon" : "opponentPokemon";

  // Persist hp=0 for the fainted Pokémon
  if (loser.pokemon._id) {
    await updatePokemon(loser.pokemon._id, { hp: 0 }).catch(() => {});
  }

  // ── Check whether the loser still has alive Pokémon ──────────────────────
  const loserParty = await getTrainerParty(loserJid);
  const faintedId  = (loser.pokemon._id || loser.pokemon.id)?.toString();
  const aliveRemainder = (loserParty || []).filter(p => {
    const pid = (p._id || p.id)?.toString();
    return (p.hp || 0) > 0 && pid !== faintedId;
  });

  const faintedName = loser.pokemon.displayName || loser.pokemon.name;
  const faintText   = `💀 *${loser.name}'s ${faintedName} has fainted!*`;

  if (aliveRemainder.length > 0) {
    // Keep the battle alive — loser must send out another Pokémon
    updateBattle(jid, {
      [winnerPokemonKey]: rewardedWinnerPokemon,
      [loserPokemonKey]:  { ...loser.pokemon, hp: 0 },
      turn: isLoserChallenger ? "challenger" : "opponent",
    });

    const partyList = aliveRemainder.map((p, i) => {
      const emoji = TYPE_EMOJIS[p.primaryType] || "⭐";
      return `${i + 1}. ${emoji} *${p.displayName || p.name}* Lv.${p.level} ❤️ ${p.hp}/${p.maxHp}`;
    }).join("\n");

    const winnerPokeName = winner.pokemon.displayName || winner.pokemon.name;

    await sock.sendMessage(jid, {
      text:
`${faintText}

✨ *${winner.name}'s ${winnerPokeName}* gained *+${xp} XP* for defeating a Lv.${loser.pokemon.level} Pokémon.${xpRes?.leveledUp ? `\n🎉 *${winnerPokeName} leveled up! Now Lv.${xpRes.newLevel}!*` : ""}

🔄 *${loser.name}, send out another Pokémon to continue!*

*Available Pokémon:*
${partyList}

➤ \`.battle switch <slot number>\` to keep fighting!`,
    }, { quoted: msg });
    return;
  }

  // ── Loser has no Pokémon left — end the battle ────────────────────────────
  const coins    = coinReward((winner.pokemon.level + loser.pokemon.level) / 2) * 2;
  await addMoney(winner.jid, coins);
  await updateTrainer(winner.jid, { $inc: { wins: 1 } });
  await updateTrainer(loser.jid,  { $inc: { losses: 1 } });

  endBattle(jid);

  const winPokeName = winner.pokemon.displayName || winner.pokemon.name;
  let resultText =
`🏆 *${winner.name.toUpperCase()} WINS THE BATTLE!*

🐉 *${winner.name}'s ${winPokeName}* defeated *${loser.name}'s ${faintedName}*!
✨ +${xp} XP for defeating a Lv.${loser.pokemon.level} Pokémon  💰 +${coins} coins`;

  if (xpRes?.leveledUp) {
    resultText += `\n🎉 *${winPokeName} leveled up! Now Lv.${xpRes.newLevel}!*`;

    // ── Auto-evolve on level up ────────────────────────────────────────────
    const evoTarget = getLevelEvolution(winner.pokemon.name, xpRes.newLevel);
    if (evoTarget) {
      try {
        const newApiData  = await fetchPokemon(evoTarget);
        const evolved     = await evolvePokemon(winnerId, newApiData);
        if (evolved) {
          const evolvedName = evolved.displayName || evolved.name;
          resultText += `\n\n✨ *WHAT?! ${winPokeName.toUpperCase()} IS EVOLVING!*\n🌟 *${winPokeName}* → *${evolvedName}*! 🎉`;
        }
      } catch {}
    }
  }

  try {
    const buf = await generateBattleResult({
      winner: { name: winner.pokemon.displayName || winner.pokemon.name, imageUrl: winner.pokemon.imageUrl },
      loser:  { name: loser.pokemon.displayName  || loser.pokemon.name,  imageUrl: loser.pokemon.imageUrl },
      rewardText: `${winner.name} wins! +${xp} XP`,
    });
    await sock.sendMessage(jid, { image: buf, caption: resultText }, { quoted: msg });
  } catch {
    await sock.sendMessage(jid, { text: resultText }, { quoted: msg });
  }

  await checkMoveLearn(sock, jid, msg, winner.jid, xpRes);
}


/**
 * Handle a player's Pokémon fainting.
 * If they have other alive Pokémon, keep the battle alive and prompt a switch.
 * If they have none left, end the battle.
 */
async function handlePlayerFaint(sock, jid, msg, battle, trainerJid, faintedPokemon, enemyPokemon, isWild) {
  const tr     = await getTrainer(trainerJid);
  const trName = tr?.username || msg.pushName || "Trainer";
  const faintedName = faintedPokemon.displayName || faintedPokemon.name;

  // Persist hp = 0 to DB
  if (faintedPokemon._id) {
    await updatePokemon(faintedPokemon._id, { hp: 0 }).catch(() => {});
  }

  // Check for other alive Pokémon
  const party      = await getTrainerParty(trainerJid);
  const curId      = (faintedPokemon._id || faintedPokemon.id)?.toString();
  const otherAlive = (party || []).filter(p => {
    const pid = (p._id || p.id)?.toString();
    return (p.hp || 0) > 0 && pid !== curId;
  });

  const faintText = `💀 *${trName}'s ${faintedName} has fainted!*`;

  if (otherAlive.length > 0) {
    // Keep the battle going — challenger must switch
    const isChallenger = battle.challengerJid === trainerJid;
    updateBattle(jid, isChallenger
      ? { challengerPokemon: { ...faintedPokemon, hp: 0 }, turn: "challenger" }
      : { opponentPokemon:   { ...faintedPokemon, hp: 0 }, turn: "opponent"   }
    );

    const partyList = otherAlive.map((p, i) => {
      const emoji = TYPE_EMOJIS[p.primaryType] || "⭐";
      return `${i + 1}. ${emoji} *${p.displayName || p.name}* Lv.${p.level} ❤️ ${p.hp}/${p.maxHp}`;
    }).join("\n");

    await sock.sendMessage(jid, {
      text:
`${faintText}

🔄 *Send out another Pokémon to continue!*

*Available Pokémon:*
${partyList}

➤ \`.battle switch <slot number>\` to keep fighting!`,
    }, { quoted: msg });
  } else {
    // No more Pokémon — trainer blacks out
    endBattle(jid);
    if (isWild) clearWild(jid);

    const caption = `${faintText}\n☠️ *${trName} has no Pokémon left! You blacked out!*\nUse *.heal* to recover your party.`;
    try {
      const buf = await generateBattleResult({
        winner: { name: enemyPokemon.displayName || enemyPokemon.name, imageUrl: enemyPokemon.imageUrl },
        loser:  { name: faintedName, imageUrl: faintedPokemon.imageUrl },
        rewardText: `${trName} blacked out!`,
      });
      await sock.sendMessage(jid, { image: buf, caption }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, { text: caption }, { quoted: msg });
    }
  }
}

async function resolveWildCounterAfterItem(sock, jid, msg, sender, isChallenger, battle) {
  const currentBattle = getBattle(jid);
  if (!currentBattle) return;
  const wildPokemon = currentBattle.opponentPokemon;
  const activePokemon = isChallenger ? currentBattle.challengerPokemon : currentBattle.opponentPokemon;
  const wildMoves = wildPokemon.moves || [];
  if (!wildMoves.length) {
    updateBattle(jid, { turn: "challenger" });
    return sendBattlePrompt(
      sock,
      jid,
      msg,
      isChallenger ? currentBattle.challengerPokemon : currentBattle.opponentPokemon,
      isChallenger ? currentBattle.opponentPokemon : currentBattle.challengerPokemon,
      "wild",
      sender,
    );
  }

  if (Number(wildPokemon.stunnedTurns) > 0) {
    const recoveredWild = { ...wildPokemon, stunnedTurns: 0 };
    const afterStun = updateBattle(jid, { opponentPokemon: recoveredWild, turn: "challenger" });
    await sock.sendMessage(jid, { text: `⚡ Wild ${recoveredWild.displayName || recoveredWild.name} is stunned and cannot move!` }, { quoted: msg });
    if (afterStun) {
      return sendBattlePrompt(sock, jid, msg, afterStun.challengerPokemon, afterStun.opponentPokemon, "wild", sender);
    }
    return;
  }

  const wildMove = wildMoves[Math.floor(Math.random() * wildMoves.length)];
  const dodged = Boolean(activePokemon.dodgeNextHit) && Math.random() < 0.5;
  const rawDamage = dodged ? 0 : calcDamage(wildPokemon, activePokemon, wildMove, currentBattle.weather);
  const critical = !dodged && Math.random() < 0.0625;
  const damage = critical ? Math.floor(rawDamage * 1.5) : rawDamage;
  const newHp = Math.max(0, activePokemon.hp - damage);
  const stunned = !dodged && !activePokemon.guardSpec && wildMove.type === "electric" &&
    wildMove.power > 0 && Math.random() < 0.25 && newHp > 0;
  const updatedPlayer = {
    ...activePokemon,
    hp: newHp,
    dodgeNextHit: false,
    guardSpec: false,
    ...(stunned ? { stunnedTurns: 1 } : {}),
  };
  const stateAfterWild = updateBattle(jid, isChallenger
    ? { challengerPokemon: updatedPlayer, turn: "challenger" }
    : { opponentPokemon: updatedPlayer, turn: "opponent" });
  const playerName = updatedPlayer.displayName || updatedPlayer.name;
  const wildName = wildPokemon.displayName || wildPokemon.name;
  const senderNum = String(sender).split("@")[0];
  await sock.sendMessage(jid, {
    text: `Wild ${wildName} used ${wildMove.name}${critical ? " ⚡ Critical hit!" : ""}${dodged ? `, but ${playerName} dodged it!` : ""}`,
  }, { quoted: msg });
  if (stunned) await sock.sendMessage(jid, { text: `⚡ ${playerName} was stunned and will miss its next move!` }, { quoted: msg });
  const caption = newHp <= 0
    ? `Wild ${wildName} dealt ${damage} damage to @${senderNum}'s ${playerName}\n💀 *${playerName} fainted!*`
    : dodged
      ? `${playerName} dodged the attack and took no damage.`
      : `Wild ${wildName} dealt ${damage} damage to @${senderNum}'s ${playerName}`;
  if (newHp <= 0) {
    await sendScene(sock, jid, msg, stateAfterWild || currentBattle, caption, "player", damage, critical, [sender]);
    return handlePlayerFaint(sock, jid, msg, battle, sender, updatedPlayer, wildPokemon, true);
  }
  await sendScene(sock, jid, msg, stateAfterWild, caption, "player", damage, critical, [sender]);
  const freshBattle = getBattle(jid);
  if (freshBattle) {
    return sendBattlePrompt(
      sock,
      jid,
      msg,
      isChallenger ? freshBattle.challengerPokemon : freshBattle.opponentPokemon,
      isChallenger ? freshBattle.opponentPokemon : freshBattle.challengerPokemon,
      "wild",
      sender,
    );
  }
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default {
  name: "battle",
  aliases: ["b"],
  description: "Battle commands: fight, run, item, pokeball, switch",
  category: "pokemon",
  usage: ".battle <fight|run|item|pokeball|switch> [args]",

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;
    let sub = (args[0] || "").toLowerCase();

    const battle = getBattle(jid);
    if (!battle) {
      return sock.sendMessage(jid, {
        text: "⚔️ No active battle here!\nUse *.catch* to start a wild battle or *.ch @user* to challenge someone.",
      }, { quoted: msg });
    }

    const isChallenger = battle.challengerJid === sender;
    const isOpponent   = battle.opponentJid   === sender;
    if (!isChallenger && !isOpponent) {
      return sock.sendMessage(jid, { text: "❌ You are not in this battle!" }, { quoted: msg });
    }

    const myPokemon    = isChallenger ? battle.challengerPokemon : battle.opponentPokemon;
    const enemyPokemon = isChallenger ? battle.opponentPokemon   : battle.challengerPokemon;

    if (Number(myPokemon.stunnedTurns) > 0) {
      const remaining = Math.max(0, Number(myPokemon.stunnedTurns) - 1);
      const stunnedPokemon = { ...myPokemon, stunnedTurns: remaining };
      updateBattle(jid, isChallenger
        ? { challengerPokemon: stunnedPokemon, ...(battle.type === "pvp" ? { turn: "opponent" } : {}) }
        : { opponentPokemon: stunnedPokemon, ...(battle.type === "pvp" ? { turn: "challenger" } : {}) }
      );
      return sock.sendMessage(jid, {
        text: `⚡ ${myPokemon.displayName || myPokemon.name} is stunned and cannot move this turn.${remaining ? ` ${remaining} turn(s) remain.` : ""}`,
      }, { quoted: msg });
    }

    // ── RUN ──────────────────────────────────────────────────────────────────
    if (sub === "run" || sub === "flee") {
      endBattle(jid);
      if (battle.type === "wild") clearWild(jid);

      const fleeCaption = battle.type === "pvp"
        ? `🏳️ *${msg.pushName || sender.split("@")[0]} has forfeited the battle!*`
        : "🏃 *You fled from the battle!*";

      try {
        const buf = await generateBattleResult({
          winner: { name: enemyPokemon.displayName || enemyPokemon.name, imageUrl: enemyPokemon.imageUrl },
          loser:  { name: myPokemon.displayName    || myPokemon.name,    imageUrl: myPokemon.imageUrl },
          rewardText: battle.type === "pvp" ? "Forfeited!" : "Fled from battle!",
          outcome: "fled",
        });
        return sock.sendMessage(jid, { image: buf, caption: fleeCaption }, { quoted: msg });
      } catch {
        return sock.sendMessage(jid, { text: fleeCaption }, { quoted: msg });
      }
    }

    // ── ITEM (show bag menu if no args, or use an item) ───────────────────────
    if (sub === "item" || sub === "items" || sub === "use" || sub === "bag") {
      if (!isMyTurn(jid, sender)) {
        return sock.sendMessage(jid, { text: "⏳ It's not your turn!" }, { quoted: msg });
      }

      const trainer = await getTrainer(sender);
      const inv     = trainer?.inventory || {};

      // No item specified → show full in-battle bag
      if (!args[1]) {
        const myName    = myPokemon.displayName    || myPokemon.name;
        const enemyName = enemyPokemon.displayName || enemyPokemon.name;

        // Pokéballs
        const ballKeys = ["pokeball","greatball","ultraball","masterball","premierball","healball","duskball","netball","luxuryball","quickball","beastball"];
        const ballLines = ballKeys.filter(k => (inv[k] || 0) > 0).map(k => {
          const item = MART_ITEMS[k];
          return `  ${item?.emoji || "🎾"} *${item?.name || k}* × ${inv[k]}  — ${item?.desc || ""}\n     ➤ \`.battle pokeball ${k}\``;
        });

        // Healing items are intentionally omitted from the active battle bag.
        const healLines = [];

        // Battle items
        const battleKeys = Object.keys(BATTLE_ITEM_EFFECTS);
        const battleLines = battleKeys.filter(k => (inv[k] || 0) > 0).map(k => {
          const item = MART_ITEMS[k];
          return `  ${item?.emoji || "⚔️"} *${item?.name || k}* × ${inv[k]}  — ${item?.desc || ""}\n     ➤ \`.battle item ${k}\``;
        });

        const hasBalls   = ballLines.length   > 0;
        const hasHeals   = healLines.length   > 0;
        const hasBattles = battleLines.length > 0;

        const nothingMsg = (!hasBalls && !hasHeals && !hasBattles)
          ? "\n⚠️ *Your bag is empty!* Visit *.mart* to buy items."
          : "";

        return sock.sendMessage(jid, {
          text:
`🎒 *BATTLE BAG*
🐉 ${myPokemon.displayName || myPokemon.name} Lv.${myPokemon.level} ❤️ ${myPokemon.hp}/${myPokemon.maxHp}
🐾 ${enemyPokemon.displayName || enemyPokemon.name} Lv.${enemyPokemon.level} ❤️ ${enemyPokemon.hp}/${enemyPokemon.maxHp}

${hasBalls ? `🎾 *POKÉBALLS* ${battle.type !== "wild" ? "_(wild battles only)_" : ""}\n${ballLines.join("\n")}\n` : ""}${hasHeals ? `\n💊 *HEALING ITEMS*\n${healLines.join("\n")}\n` : ""}${hasBattles ? `\n⚔️ *BATTLE ITEMS*\n${battleLines.join("\n")}\n` : ""}${nothingMsg}
━━━━━━━━━━━━━━━━━━━━
🔙 Back to moves: \`.battle fight\``,
        }, { quoted: msg });
      }

            const itemKey = args[1].toLowerCase().replace(/\s/g, "");
      const healingItemKeys = ["potion", "superpotion", "hyperpotion", "fullrestore", "revive", "maxrevive"];
      if (healingItemKeys.includes(itemKey)) {
        return sock.sendMessage(jid, {
          text: "🚫 Healing items are disabled during battles. Switch Pokémon or use *.heal* after the battle ends.",
        }, { quoted: msg });
      }
      const battleItem = BATTLE_ITEM_EFFECTS[itemKey];
      if (battleItem) {
        if (!(inv[itemKey] > 0)) {
          return sock.sendMessage(jid, {
            text: `❌ You don't have any *${battleItem.name}*!\nVisit *.mart* to stock up.`,
          }, { quoted: msg });
        }
        if ((myPokemon.hp ?? 0) <= 0) {
          return sock.sendMessage(jid, { text: `❌ ${myPokemon.displayName || myPokemon.name} has fainted. Switch Pokémon first.` }, { quoted: msg });
        }
        const result = applyBattleItem(myPokemon, itemKey);
        if (!result.ok) {
          return sock.sendMessage(jid, {
            text: result.reason === "already-used"
              ? `${battleItem.name} has already been used by this Pokémon in this battle.`
              : "That battle item is unavailable.",
          }, { quoted: msg });
        }
        if (!await removeItem(sender, itemKey)) {
          return sock.sendMessage(jid, { text: `❌ You no longer have *${battleItem.name}*.` }, { quoted: msg });
        }
        const updated = updateBattle(jid, isChallenger
          ? { challengerPokemon: result.pokemon, turn: "opponent" }
          : { opponentPokemon: result.pokemon, turn: "challenger" });
        await sock.sendMessage(jid, {
          text: `🧰 *${battleItem.name} used!*\n${battleItem.description}`,
        }, { quoted: msg });
        if (battle.type === "wild") {
          return resolveWildCounterAfterItem(sock, jid, msg, sender, isChallenger, battle);
        }
        if (battle.type === "pvp" && updated) {
          await sleep(DELAY);
          const freshBattle = getBattle(jid);
          if (freshBattle) await sendNextPvPPrompt(sock, jid, msg, freshBattle);
        }
        return;
      }
      // If a ball was specified under .battle item, redirect to pokeball logic

      const ballTypes = ["pokeball","greatball","ultraball","masterball","premierball","healball","duskball","netball","luxuryball","quickball","beastball","moonball","dreamball","cherishball"];
      if (ballTypes.some(b => b === itemKey || itemKey.includes(b.replace("ball","")))) {
        sub = "pokeball";
        args[1] = itemKey;
        // Fall through to pokeball handler below by re-routing sub
      } else {
        // Heal item
        const healMap = {
          potion: 20, superpotion: 50, hyperpotion: 120,
          fullrestore: 9999, revive: "half", maxrevive: "full",
        };

        const healAmt = healMap[itemKey];
        if (!healAmt) {
          return sock.sendMessage(jid, {
            text: `❌ Unknown item *${itemKey}*!\nUse \`.battle item\` to see your bag.`,
          }, { quoted: msg });
        }

        if (!(inv[itemKey] > 0)) {
          return sock.sendMessage(jid, {
            text: `❌ You don't have any *${itemKey}*!\nVisit *.mart* to stock up.`,
          }, { quoted: msg });
        }

        // Revives can only be used on fainted Pokémon via party management, not in-battle active Pokémon
        if ((itemKey === "revive" || itemKey === "maxrevive") && myPokemon.hp > 0) {
          return sock.sendMessage(jid, {
            text: `❌ *${itemKey}* can only be used on a fainted Pokémon!\nUse a Potion to heal your current Pokémon.`,
          }, { quoted: msg });
        }

        // Guard: potions/healing items cannot be used on a fainted active Pokémon
        if ((myPokemon.hp ?? 0) <= 0 && itemKey !== "revive" && itemKey !== "maxrevive") {
          return sock.sendMessage(jid, {
            text: `❌ *${myPokemon.displayName || myPokemon.name}* has fainted!\nUse a *Revive* or \`.battle switch\` to send out another Pokémon.`,
          }, { quoted: msg });
        }

        let newHp;
        if (healAmt === "half")  newHp = Math.min(myPokemon.maxHp, myPokemon.hp + Math.floor(myPokemon.maxHp / 2));
        else if (healAmt === "full") newHp = myPokemon.maxHp;
        else newHp = Math.min(myPokemon.maxHp, (myPokemon.hp || 0) + healAmt);

        const updated = updateBattle(jid, isChallenger
          ? { challengerPokemon: { ...myPokemon, hp: newHp }, turn: isChallenger ? "opponent" : "challenger" }
          : { opponentPokemon:   { ...myPokemon, hp: newHp }, turn: isChallenger ? "opponent" : "challenger" }
        );

        if (myPokemon._id) await updatePokemon(myPokemon._id, { hp: newHp }).catch(() => {});
        await removeItem(sender, itemKey);

        const myName = myPokemon.displayName || myPokemon.name;
        await sock.sendMessage(jid, {
          text: `💊 *Used ${itemKey}!*\n❤️ ${myName}: ${myPokemon.hp} → ${newHp}/${myPokemon.maxHp}`,
        }, { quoted: msg });

        // Wild auto-counter after using item
        if (battle.type === "wild" && updated) {
          const currentBattle = getBattle(jid);
          if (!currentBattle) return;
          const wildMoves = currentBattle.opponentPokemon.moves || [];
          if (wildMoves.length > 0) {
            const wildMove     = wildMoves[Math.floor(Math.random() * wildMoves.length)];
            const wildDmg      = calcDamage(currentBattle.opponentPokemon, { ...myPokemon, hp: newHp }, wildMove, currentBattle.weather);
            const wildCrit     = Math.random() < 0.0625;
            const wildFinalDmg = wildCrit ? Math.floor(wildDmg * 1.5) : wildDmg;
            const newPlayerHp  = Math.max(0, newHp - wildFinalDmg);
            const updatedAfterWild = { ...myPokemon, hp: newPlayerHp };
            const stateAfterWild   = updateBattle(jid, isChallenger
              ? { challengerPokemon: updatedAfterWild, turn: "challenger" }
              : { opponentPokemon:   updatedAfterWild, turn: "opponent"   }
            );

            const wildEnemyName = currentBattle.opponentPokemon.displayName || currentBattle.opponentPokemon.name;
            const itemSenderNum = sender.split("@")[0];
            await sleep(DELAY);
            await sock.sendMessage(jid, {
              text: `Wild ${wildEnemyName} used ${wildMove.name} at ${myName}${wildCrit ? " ⚡ Critical hit!" : ""}`,
            }, { quoted: msg });
            const itemWildEff = effectivenessText(getTypeEffectiveness(wildMove.type, { ...myPokemon, hp: newHp }.types || (myPokemon.primaryType ? [myPokemon.primaryType] : [])));
            if (itemWildEff) await sock.sendMessage(jid, { text: itemWildEff }, { quoted: msg });
            await sleep(DELAY);

            const wildCaption = newPlayerHp <= 0
              ? `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${itemSenderNum} 's ${myName}\n💀 *${myName} has fainted!*`
              : `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${itemSenderNum} 's ${myName}`;

            if (newPlayerHp <= 0) {
              await sendScene(sock, jid, msg, stateAfterWild || updated, wildCaption, "player", wildFinalDmg, wildCrit, [sender]);
              await handlePlayerFaint(sock, jid, msg, battle, sender, updatedAfterWild, currentBattle.opponentPokemon, true);
            } else {
              await sendScene(sock, jid, msg, stateAfterWild, wildCaption, "player", wildFinalDmg, wildCrit, [sender]);
              await sleep(DELAY);
              const freshBattle = getBattle(jid);
              if (freshBattle) {
                await sendBattlePrompt(sock, jid, msg,
                  isChallenger ? freshBattle.challengerPokemon : freshBattle.opponentPokemon,
                  isChallenger ? freshBattle.opponentPokemon   : freshBattle.challengerPokemon,
                  "wild", sender
                );
              }
            }
          }
        } else if (battle.type === "pvp" && updated) {
          await sleep(DELAY);
          const freshBattle = getBattle(jid);
          if (freshBattle) await sendNextPvPPrompt(sock, jid, msg, freshBattle);
        }

        return;
      }
    }

    // ── POKEBALL ──────────────────────────────────────────────────────────────
    if (sub === "pokeball" || sub === "ball" || sub === "catch" || sub === "throw") {
      if (battle.type !== "wild") {
        return sock.sendMessage(jid, {
          text: "❌ You can only throw Pokéballs in wild battles!",
        }, { quoted: msg });
      }
      if (!isMyTurn(jid, sender)) {
        return sock.sendMessage(jid, { text: "⏳ It's not your turn!" }, { quoted: msg });
      }

      const validBalls = ["pokeball","greatball","ultraball","masterball","premierball","healball","duskball","netball","luxuryball","quickball","beastball","moonball","dreamball","cherishball"];
      const rawInput   = (args[1] || "pokeball").toLowerCase().replace(/\s/g, "");
      const ball       = validBalls.find(b => b === rawInput || rawInput.includes(b.replace("ball", ""))) || "pokeball";

      const trainer = await getTrainer(sender);
      const inv     = trainer?.inventory || {};

      if (!(inv[ball] > 0)) {
        return sock.sendMessage(jid, {
          text: `❌ You don't have any *${ball}*!\nVisit *.mart* to buy Pokéballs.`,
        }, { quoted: msg });
      }

      const wildPokemon = battle.opponentPokemon;
      if (wildPokemon.isFusionBoss || wildPokemon.noCapture) {
        return sock.sendMessage(jid, { text: "🛡️ This fused Pokémon is protected and cannot be caught." }, { quoted: msg });
      }

      const hpRatio = wildPokemon.hp / wildPokemon.maxHp;
      let caught;
      if (ball === "beastball") {
        caught = true;
      } else {
        const catchMods = {
          masterball: 1000, ultraball: 2.5, greatball: 1.5,
          netball: 3, duskball: 3.5, quickball: 5,
          healball: 1.5, premierball: 1.5, luxuryball: 1,
          moonball: 2, dreamball: 2.5, cherishball: 3,
          pokeball: 1,
        };
        const mod = catchMods[ball] || 1;
        const baseCatch = Math.max(0.05, (1 - hpRatio) * 0.6 + 0.1);
        const catchRate = Math.min(0.95, baseCatch * mod);
        caught = Math.random() < catchRate;
      }

      const removed = await removeItem(sender, ball);
      if (!removed) {
        return sock.sendMessage(jid, { text: "❌ You no longer have that Pokéball." }, { quoted: msg });
      }
      updateBattle(jid, { catchAttempts: (battle.catchAttempts || 0) + 1 });

      const ballNames = {
        pokeball: "Poké Ball", greatball: "Great Ball", ultraball: "Ultra Ball",
        masterball: "Master Ball", premierball: "Premier Ball", healball: "Heal Ball",
        duskball: "Dusk Ball", netball: "Net Ball", luxuryball: "Luxury Ball",
        quickball: "Quick Ball", beastball: "Beast Ball",
        moonball: "Moon Ball", dreamball: "Dream Ball", cherishball: "Cherish Ball",
      };
      const pokeName = wildPokemon.displayName || wildPokemon.name;
      const userName = msg.discordChannelId
        ? (msg.pushName || String(sender).replace(/^discord:/, "").split("@")[0])
        : String(sender).split("@")[0];
      const throwCaption = "@" + userName + " used " + (ballNames[ball] || "Poké Ball") + " on " + pokeName + "!\nWill it be caught or break free?";

      try {
        const ballAnimation = await readPokemonAnimation("pokeball");
        const mediaMessage = {
          video: ballAnimation,
          mimetype: "video/mp4",
          fileName: "pokeball.mp4",
          gifPlayback: true,
          caption: throwCaption,
          ...(!msg.discordChannelId ? { mentions: [sender] } : {}),
        };
        await sock.sendMessage(jid, mediaMessage, { quoted: msg });
      } catch {
        await sock.sendMessage(jid, {
          text: throwCaption,
          ...(!msg.discordChannelId ? { mentions: [sender] } : {}),
        }, { quoted: msg });
      }
      await sleep(1400);

      if (caught) {
        endBattle(jid);
        clearWild(jid);
        const party = await getTrainerParty(sender);
        const inParty = (party || []).length < 6;
        const savedPokemon = await savePokemon({
          ...wildPokemon,
          ownerJid: sender,
          inParty,
          caughtAt: Date.now(),
        });
        if (inParty) await addToParty(sender, savedPokemon._id.toString());
        else await addToPC(sender, savedPokemon._id.toString());

        const catchXp = Math.max(10, Math.floor(wildPokemon.level * 3));
        const myPokeId = myPokemon._id || myPokemon.id;
        if (myPokeId) await addPokemonXP(myPokeId, catchXp).catch(() => null);
        const catchGold = coinReward(wildPokemon.level);
        await addMoney(sender, catchGold);
        return sock.sendMessage(jid, {
          text: pokeName + " was caught! You gained " + catchXp + " XP and $" + Number(catchGold).toLocaleString() + ".",
        }, { quoted: msg });
      }

      await sock.sendMessage(jid, { text: pokeName + " broke free!" }, { quoted: msg });
      if (!caught) {
        // Wild counter-attack after failed catch
        const currentBattle = getBattle(jid);
        if (!currentBattle) return;
        updateBattle(jid, { turn: "challenger" });

        const wildMoves = currentBattle.opponentPokemon.moves || [];
        if (wildMoves.length > 0) {
          const wildMove     = wildMoves[Math.floor(Math.random() * wildMoves.length)];
          const dodgeWasReady = Boolean(myPokemon.dodgeNextHit);
          const wildDodged = dodgeWasReady && Math.random() < 0.5;
          const wildDmg = wildDodged ? 0 : calcDamage(currentBattle.opponentPokemon, myPokemon, wildMove, currentBattle.weather);
          const wildCrit = !wildDodged && Math.random() < 0.0625;
          const wildFinalDmg = wildCrit ? Math.floor(wildDmg * 1.5) : wildDmg;
          const newPlayerHp  = Math.max(0, myPokemon.hp - wildFinalDmg);
          const stunAttempted = !wildDodged && wildMove.type === "electric" && wildMove.power > 0 &&
            Math.random() < 0.25 && newPlayerHp > 0;
          const guardBlockedStun = stunAttempted && Boolean(myPokemon.guardSpec);
          const updatedPlayer = {
            ...myPokemon,
            hp: newPlayerHp,
            ...(dodgeWasReady ? { dodgeNextHit: false } : {}),
            ...(guardBlockedStun ? { guardSpec: false } : {}),
            ...(stunAttempted && !guardBlockedStun ? { stunnedTurns: 1 } : {}),
          };
          const stateAfterWild = updateBattle(jid, isChallenger
            ? { challengerPokemon: updatedPlayer, turn: "challenger" }
            : { opponentPokemon:   updatedPlayer, turn: "opponent"   }
          );

          const wildEnemyName = currentBattle.opponentPokemon.displayName || currentBattle.opponentPokemon.name;
          const myName = myPokemon.displayName || myPokemon.name;
          const ballSenderNum = sender.split("@")[0];

          await sleep(DELAY);
          await sock.sendMessage(jid, {
            text: `Wild ${wildEnemyName} used ${wildMove.name} at ${myName}${wildDodged ? " — but the attack was dodged!" : wildCrit ? " ⚡ Critical hit!" : ""}`,
          }, { quoted: msg });
          const ballWildEff = effectivenessText(getTypeEffectiveness(wildMove.type, myPokemon.types || (myPokemon.primaryType ? [myPokemon.primaryType] : [])));
          if (ballWildEff) await sock.sendMessage(jid, { text: ballWildEff }, { quoted: msg });
          if (stunAttempted && !guardBlockedStun) {
            await sock.sendMessage(jid, { text: `⚡ ${myName} was stunned and will miss its next move!` }, { quoted: msg });
          } else if (guardBlockedStun) {
            await sock.sendMessage(jid, { text: `🛡️ ${myName}'s Guard Spec blocked the stun!` }, { quoted: msg });
          }
          await sleep(DELAY);

          const wildCaption = newPlayerHp <= 0
            ? `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${ballSenderNum} 's ${myName}\n💀 *${myName} has fainted!*`
            : `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${ballSenderNum} 's ${myName}`;

          if (newPlayerHp <= 0) {
            await sendScene(sock, jid, msg, stateAfterWild || currentBattle, wildCaption, "player", wildFinalDmg, wildCrit, [sender]);
            await handlePlayerFaint(sock, jid, msg, { ...currentBattle, challengerJid: sender }, sender, updatedPlayer, currentBattle.opponentPokemon, true);
          } else {
            await sendScene(sock, jid, msg, stateAfterWild, wildCaption, "player", wildFinalDmg, wildCrit, [sender]);
            await sleep(DELAY);
            const freshBattle = getBattle(jid);
            if (freshBattle) {
              await sendBattlePrompt(sock, jid, msg,
                isChallenger ? freshBattle.challengerPokemon : freshBattle.opponentPokemon,
                isChallenger ? freshBattle.opponentPokemon   : freshBattle.challengerPokemon,
                "wild", sender
              );
            }
          }
        }
      }

      return;
    }

    // ── SWITCH ────────────────────────────────────────────────────────────────
    if (sub === "switch" || sub === "swap") {
      if (!isMyTurn(jid, sender)) {
        return sock.sendMessage(jid, { text: "⏳ It's not your turn!" }, { quoted: msg });
      }

      const party      = await getTrainerParty(sender);
      const aliveParty = (party || []).filter(p => p.hp > 0);

      if (!args[1]) {
        // When current Pokémon is fainted (hp=0), we only need 1 alive; when alive we need 2+
        const myCurrentAlive = (myPokemon.hp || 0) > 0;
        const minimumNeeded  = myCurrentAlive ? 2 : 1;
        if (aliveParty.length < minimumNeeded) {
          return sock.sendMessage(jid, {
            text: "❌ You have no other Pokémon to switch to!\nAll others have fainted. Use *.heal* after battle.",
          }, { quoted: msg });
        }

        const myCurrentId = (myPokemon._id || myPokemon.id)?.toString();
        const partyList   = aliveParty.map((p, i) => {
          const isCurrent = (p._id || p.id)?.toString() === myCurrentId;
          const emoji     = TYPE_EMOJIS[p.primaryType] || "⭐";
          return `${i + 1}. ${emoji} *${p.displayName || p.name}* Lv.${p.level} ❤️ ${p.hp}/${p.maxHp}${isCurrent ? " *(current)*" : ""}`;
        }).join("\n");

        return sock.sendMessage(jid, {
          text:
`🔄 *SWITCH POKÉMON*

*Your Party (alive):*
${partyList}

Reply: \`.battle switch <slot number>\``,
        }, { quoted: msg });
      }

      const slotNum  = parseInt(args[1]);
      if (isNaN(slotNum) || slotNum < 1 || slotNum > aliveParty.length) {
        return sock.sendMessage(jid, {
          text: `❌ Invalid slot! Choose between *1* and *${aliveParty.length}*.\nType \`.battle switch\` to see your party.`,
        }, { quoted: msg });
      }

      const newPoke     = aliveParty[slotNum - 1];
      const myCurrentId = (myPokemon._id || myPokemon.id)?.toString();
      const newPokeId   = (newPoke._id || newPoke.id)?.toString();

      if (newPokeId === myCurrentId) {
        return sock.sendMessage(jid, {
          text: `❌ *${newPoke.displayName || newPoke.name}* is already in battle!`,
        }, { quoted: msg });
      }

      // Persist the outgoing Pokémon's current HP so it isn't restored to full
      // when the trainer retrieves it again from the DB later in the battle.
      if (myPokemon._id && (myPokemon.hp ?? 0) > 0) {
        await updatePokemon(myPokemon._id, { hp: myPokemon.hp }).catch(() => {});
      }

      updateBattle(jid, isChallenger
        ? { challengerPokemon: newPoke, turn: "opponent" }
        : { opponentPokemon: newPoke, turn: "challenger" }
      );

      const oldName = myPokemon.displayName || myPokemon.name;
      const newName = newPoke.displayName   || newPoke.name;

      await sock.sendMessage(jid, {
        text: `🔄 *${oldName}* → *${newName}*!\n${newName} is now in battle! ❤️ ${newPoke.hp}/${newPoke.maxHp}`,
      }, { quoted: msg });

      // Wild auto-counter after switch
      if (battle.type === "wild") {
        const currentBattle = getBattle(jid);
        if (!currentBattle) return;
        const wildMoves = currentBattle.opponentPokemon.moves || [];
        if (wildMoves.length > 0) {
          const wildMove     = wildMoves[Math.floor(Math.random() * wildMoves.length)];
          const wildDmg      = calcDamage(currentBattle.opponentPokemon, newPoke, wildMove, currentBattle.weather);
          const wildCrit     = Math.random() < 0.0625;
          const wildFinalDmg = wildCrit ? Math.floor(wildDmg * 1.5) : wildDmg;
          const newPlayerHp  = Math.max(0, newPoke.hp - wildFinalDmg);
          const updatedSwitched = { ...newPoke, hp: newPlayerHp };
          const stateAfterWild  = updateBattle(jid, isChallenger
            ? { challengerPokemon: updatedSwitched, turn: "challenger" }
            : { opponentPokemon:   updatedSwitched, turn: "opponent" }
          );

          const wildEnemyName = currentBattle.opponentPokemon.displayName || currentBattle.opponentPokemon.name;
          const switchSenderNum = sender.split("@")[0];

          // "Wild EnemyName used MoveName at NewPokeName"
          await sock.sendMessage(jid, {
            text: `Wild ${wildEnemyName} used ${wildMove.name} at ${newName}${wildCrit ? " ⚡ Critical hit!" : ""}`,
          }, { quoted: msg });
          const switchWildEff = effectivenessText(getTypeEffectiveness(wildMove.type, newPoke.types || (newPoke.primaryType ? [newPoke.primaryType] : [])));
          if (switchWildEff) await sock.sendMessage(jid, { text: switchWildEff }, { quoted: msg });
          await sleep(DELAY);

          const wildSwitchDamageCaption = newPlayerHp <= 0
            ? `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${switchSenderNum} 's ${newName}\n💀 *${newName} has fainted!*`
            : `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${switchSenderNum} 's ${newName}`;

          if (newPlayerHp <= 0) {
            await handlePlayerFaint(sock, jid, msg, { ...currentBattle, challengerJid: sender }, sender, updatedSwitched, currentBattle.opponentPokemon, true);
          } else if (stateAfterWild) {
            await sendScene(sock, jid, msg, stateAfterWild, wildSwitchDamageCaption, "player", wildFinalDmg, wildCrit, [sender]);
            await sleep(DELAY);
            const freshBattle = getBattle(jid);
            if (freshBattle) {
              const freshMy = isChallenger ? freshBattle.challengerPokemon : freshBattle.opponentPokemon;
              await sendBattlePrompt(sock, jid, msg, freshMy, freshBattle.opponentPokemon, "wild", sender);
            }
          }
        } else {
          updateBattle(jid, { turn: "challenger" });
          await sleep(DELAY);
          const freshBattle = getBattle(jid);
          if (freshBattle) {
            await sendBattlePrompt(sock, jid, msg, newPoke, freshBattle.opponentPokemon, "wild", sender);
          }
        }
      } else if (battle.type === "pvp") {
        await sleep(DELAY);
        const freshBattle = getBattle(jid);
        if (freshBattle) {
          await sendNextPvPPrompt(sock, jid, msg, freshBattle);
        }
      }

      return;
    }

    // ── FIGHT ─────────────────────────────────────────────────────────────────
    if (sub === "fight" || sub === "attack" || sub === "move") {
      if (!isMyTurn(jid, sender)) {
        return sock.sendMessage(jid, { text: "⏳ It's not your turn!" }, { quoted: msg });
      }

      // Guard: prevent a fainted Pokémon from attacking
      if ((myPokemon.hp ?? 0) <= 0) {
        return sock.sendMessage(jid, {
          text: `❌ *${myPokemon.displayName || myPokemon.name}* has fainted and cannot fight!\nUse \`.battle switch\` to send out another Pokémon.`,
        }, { quoted: msg });
      }

      const moves  = myPokemon.moves || [];
      const myName = myPokemon.displayName    || myPokemon.name;
      const eName  = enemyPokemon.displayName || enemyPokemon.name;

      // No move number → show moves panel
      if (!args[1]) {
        return sock.sendMessage(jid, {
          text:
`⚔️ *${myName.toUpperCase()} — CHOOSE A MOVE!*

${formatMoveList(moves)}

━━━━━━━━━━━━━━━━━━━━
🐾 Enemy: *${eName}* Lv.${enemyPokemon.level} ❤️ ${enemyPokemon.hp}/${enemyPokemon.maxHp}
💊 Items: \`.battle item\`  🔄 Switch: \`.battle switch\``,
        }, { quoted: msg });
      }

      const moveIdx = parseInt(args[1]) - 1;
      if (isNaN(moveIdx) || moveIdx < 0 || moveIdx >= moves.length) {
        return sock.sendMessage(jid, {
          text: `❌ Invalid move! Choose 1–${moves.length}.\nType \`.battle fight\` to see your moves.`,
        }, { quoted: msg });
      }

      const move = moves[moveIdx];
      const accuracy = Math.min(100, Number(move.accuracy || 100) + Number(myPokemon.accuracyBonus || 0));
      const missed = Math.random() * 100 > accuracy;
      const damage = missed ? 0 : calcDamage(myPokemon, enemyPokemon, move, battle.weather);
      const crit = !missed && (Boolean(myPokemon.criticalNext) || Math.random() < 0.0625);
      const dodgeWasReady = !missed && Boolean(enemyPokemon.dodgeNextHit);
      const dodged = dodgeWasReady && Math.random() < 0.5;
      let finalDmg = dodged ? 0 : crit ? Math.floor(damage * 1.5) : damage;
      const stunAttempted = !missed && !dodged && move.type === "electric" && move.power > 0 && Math.random() < 0.25;
      const appliesStun = stunAttempted && !enemyPokemon.guardSpec;
      let shieldAbsorbed = 0;
      let shieldCharges = Number(enemyPokemon.shieldCharges || 0);
      if (enemyPokemon.isFusionBoss && shieldCharges > 0) {
        shieldAbsorbed = Math.floor(finalDmg * 0.55);
        finalDmg = Math.max(1, finalDmg - shieldAbsorbed);
        shieldCharges -= 1;
      }
      const newEnemyHp = Math.max(0, (enemyPokemon.hp ?? enemyPokemon.maxHp) - finalDmg);

      const updatedEnemy = {
        ...enemyPokemon,
        hp: newEnemyHp,
        ...(dodgeWasReady ? { dodgeNextHit: false } : {}),
        ...(stunAttempted && enemyPokemon.guardSpec ? { guardSpec: false } : {}),
        ...(appliesStun ? { stunnedTurns: 1 } : {}),
        ...(enemyPokemon.isFusionBoss ? { shieldCharges } : {}),
      };
      const updatedAttacker = {
        ...myPokemon,
        ...(Number(myPokemon.accuracyBonus) > 0 ? { accuracyBonus: 0 } : {}),
        ...(myPokemon.criticalNext ? { criticalNext: false } : {}),
      };
      const newState = {
        ...(isChallenger ? { challengerPokemon: updatedAttacker } : { opponentPokemon: updatedAttacker }),
        ...(isChallenger ? { opponentPokemon: updatedEnemy } : { challengerPokemon: updatedEnemy }),
        turn: isChallenger ? "opponent" : "challenger",
        round: battle.round + (isChallenger ? 0 : 1),
      };
      if (battle.type === "wild") {
        updateWildHp(jid, newEnemyHp, enemyPokemon.isFusionBoss ? { shieldCharges } : undefined);
      }

      const updated    = updateBattle(jid, newState);

      // Step 1 — "@Trainer 's PokeName used MoveName at EnemyName"
      const senderNum  = sender.split("@")[0];
      const usedText   = `@${senderNum} 's ${myName} used ${move.name} at ${eName}${missed ? " — it missed!" : dodged ? ` — ${eName} dodged!` : crit ? " ⚡ Critical hit!" : ""}`;
      await sock.sendMessage(jid, { text: usedText, mentions: [sender] }, { quoted: msg });

      // Type effectiveness line
      const eff = effectivenessText(getTypeEffectiveness(move.type, enemyPokemon.types || (enemyPokemon.primaryType ? [enemyPokemon.primaryType] : [])));
      if (eff) await sock.sendMessage(jid, { text: eff }, { quoted: msg });
      if (appliesStun && newEnemyHp > 0) {
        await sock.sendMessage(jid, { text: `⚡ ${eName} was stunned and will miss its next move!` }, { quoted: msg });
      } else if (stunAttempted && enemyPokemon.guardSpec) {
        await sock.sendMessage(jid, { text: `🛡️ ${eName}'s Guard Spec blocked the stun!` }, { quoted: msg });
      }

      await sleep(DELAY);

      // Step 2 — Damage scene image with dealt-damage caption
      const targetLabel   = battle.type === "wild" ? `Wild ${eName}` : eName;
      if (shieldAbsorbed > 0) {
        await sock.sendMessage(jid, { text: "🛡️ The fusion shield absorbed " + shieldAbsorbed + " damage. " + shieldCharges + " shield charges remain." }, { quoted: msg });
      }
      const damageCaption = newEnemyHp <= 0
        ? `@${senderNum} 's ${myName} dealt a damage of ${finalDmg} to ${targetLabel}\n💀 *${eName} fainted!*`
        : `@${senderNum} 's ${myName} dealt a damage of ${finalDmg} to ${targetLabel}`;

      // Enemy fainted
      if (newEnemyHp <= 0) {
        await sendScene(sock, jid, msg, updated, damageCaption, "enemy", finalDmg, crit, [sender]);
        const trainer = await getTrainer(sender);
        if (battle.type === "wild") {
          await handleWildDefeat(sock, jid, msg, { ...battle, opponentPokemon: updatedEnemy, challengerJid: battle.challengerJid }, trainer);
        } else {
          await handlePvPDefeat(sock, jid, msg,
            { ...battle, ...(isChallenger ? { opponentPokemon: updatedEnemy } : { challengerPokemon: updatedEnemy }) },
            isChallenger ? battle.opponentJid : battle.challengerJid
          );
        }
        return;
      }

      // Show damage scene
      await sendScene(sock, jid, msg, updated, damageCaption, "enemy", finalDmg, crit, [sender]);

      // Wild counter-attack after player's move
      if (battle.type === "wild" && updated) {
        const currentBattle = getBattle(jid);
        if (!currentBattle) return;
        if (Number(currentBattle.opponentPokemon.stunnedTurns) > 0) {
          const recoveredWild = { ...currentBattle.opponentPokemon, stunnedTurns: 0 };
          const afterStun = updateBattle(jid, {
            opponentPokemon: recoveredWild,
            turn: "challenger",
          });
          await sock.sendMessage(jid, {
            text: `⚡ Wild ${recoveredWild.displayName || recoveredWild.name} is stunned and cannot move!`,
          }, { quoted: msg });
          await sleep(DELAY);
          if (afterStun) {
            await sendBattlePrompt(sock, jid, msg, afterStun.challengerPokemon, afterStun.opponentPokemon, "wild", sender);
          }
          return;
        }
        const wildMoves = currentBattle.opponentPokemon.moves || [];
        if (wildMoves.length > 0) {
          const wildMove      = wildMoves[Math.floor(Math.random() * wildMoves.length)];
          const currMyPokemon = isChallenger ? currentBattle.challengerPokemon : currentBattle.opponentPokemon;
          const dodgeWasReady = Boolean(currMyPokemon.dodgeNextHit);
          const wildDodged = dodgeWasReady && Math.random() < 0.5;
          const wildDmg = wildDodged ? 0 : calcDamage(currentBattle.opponentPokemon, currMyPokemon, wildMove, currentBattle.weather);
          const wildCrit = !wildDodged && Math.random() < 0.0625;
          const wildFinalDmg  = wildCrit ? Math.floor(wildDmg * 1.5) : wildDmg;
          const newPlayerHp   = Math.max(0, currMyPokemon.hp - wildFinalDmg);
          const stunAttempted = !wildDodged && wildMove.type === "electric" && wildMove.power > 0 && Math.random() < 0.25;
          const wildStunsPlayer = stunAttempted && !currMyPokemon.guardSpec;
          const updatedPlayer = {
            ...currMyPokemon,
            hp: newPlayerHp,
            ...(dodgeWasReady ? { dodgeNextHit: false } : {}),
            ...(stunAttempted && currMyPokemon.guardSpec ? { guardSpec: false } : {}),
            ...(wildStunsPlayer && newPlayerHp > 0 ? { stunnedTurns: 1 } : {}),
          };
          const stateAfterWild = updateBattle(jid, isChallenger
            ? { challengerPokemon: updatedPlayer, turn: "challenger" }
            : { opponentPokemon:   updatedPlayer, turn: "opponent"   }
          );

          const wildEnemyName = currentBattle.opponentPokemon.displayName || currentBattle.opponentPokemon.name;

          await sleep(DELAY);
          // "Wild EnemyName used MoveName at PokeName"
          await sock.sendMessage(jid, {
            text: `Wild ${wildEnemyName} used ${wildMove.name} at ${myName}${wildDodged ? " — but the attack was dodged!" : wildCrit ? " ⚡ Critical hit!" : ""}`,
          }, { quoted: msg });
          if (wildStunsPlayer && newPlayerHp > 0) {
            await sock.sendMessage(jid, { text: `⚡ ${myName} was stunned and will miss its next move!` }, { quoted: msg });
          } else if (stunAttempted && currMyPokemon.guardSpec) {
            await sock.sendMessage(jid, { text: `🛡️ ${myName}'s Guard Spec blocked the stun!` }, { quoted: msg });
          }
          // Type effectiveness for wild counter
          const wildEff = effectivenessText(getTypeEffectiveness(wildMove.type, currMyPokemon.types || (currMyPokemon.primaryType ? [currMyPokemon.primaryType] : [])));
          if (wildEff) await sock.sendMessage(jid, { text: wildEff }, { quoted: msg });
          await sleep(DELAY);

          // Damage caption: "Wild X dealt a damage of N to @Trainer 's PokeName"
          const wildDamageCaption = newPlayerHp <= 0
            ? `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${senderNum} 's ${myName}\n💀 *${myName} has fainted!*`
            : `Wild ${wildEnemyName} dealt a damage of ${wildFinalDmg} to @${senderNum} 's ${myName}`;

          if (newPlayerHp <= 0) {
            await sendScene(sock, jid, msg, stateAfterWild || updated, wildDamageCaption, "player", wildFinalDmg, wildCrit, [sender]);
            await handlePlayerFaint(sock, jid, msg, battle, sender, updatedPlayer, updated.opponentPokemon, true);
          } else if (stateAfterWild) {
            await sendScene(sock, jid, msg, stateAfterWild, wildDamageCaption, "player", wildFinalDmg, wildCrit, [sender]);
            await sleep(DELAY);
            const freshBattle = getBattle(jid);
            if (freshBattle) {
              await sendBattlePrompt(sock, jid, msg,
                isChallenger ? freshBattle.challengerPokemon : freshBattle.opponentPokemon,
                isChallenger ? freshBattle.opponentPokemon   : freshBattle.challengerPokemon,
                "wild", sender
              );
            }
          }
        }
      } else if (battle.type === "pvp" && updated) {
        await sleep(DELAY);
        const freshBattle = getBattle(jid);
        if (freshBattle) {
          await sendNextPvPPrompt(sock, jid, msg, freshBattle);
        }
      }

      return;
    }

    // ── STATUS (default / no sub) ─────────────────────────────────────────────
    return sendBattlePrompt(sock, jid, msg, myPokemon, enemyPokemon, battle.type, sender);
  },
};
