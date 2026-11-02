// plugins/pokemon/learnmove.js
// Handles the move-learning prompt when a Pokémon levels up.
// Usage:
//   .learnmove <1-6>     — replace move in slot 1-6 with the new move
//   .learnmove cancel    — cancel, keep existing moves

import { getPendingLearn, clearPendingLearn } from "../../lib/pokemon/moveLearnState.mjs";
import { updatePokemon } from "../../lib/pokemon/pokemonDb.mjs";
import { TYPE_EMOJIS } from "../../lib/pokemon/gameLogic.mjs";

export default {
  name: "learnmove",
  aliases: ["lm"],
  description: "Decide whether to learn a new move",
  category: "pokemon",
  usage: ".learnmove <1-6 | cancel>",

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;

    const state = getPendingLearn(sender);
    if (!state) {
      return sock.sendMessage(jid, {
        text: "❌ You don't have a pending move to learn right now.",
      }, { quoted: msg });
    }

    const choice = (args[0] || "").toLowerCase();

    if (choice === "cancel" || choice === "no") {
      clearPendingLearn(sender);
      return sock.sendMessage(jid, {
        text: `✅ *${state.pokemonName}* did not learn *${state.newMove.name}*.`,
      }, { quoted: msg });
    }

    // "yes" — auto-append the move when there's still a free slot
    if (choice === "yes") {
      if (state.currentMoves.length >= 6) {
        return sock.sendMessage(jid, {
        text: `❗ *${state.pokemonName}* already knows 6 moves.\nReply *.learnmove <1-6>* to replace one, or *.learnmove cancel* to skip.`,
        }, { quoted: msg });
      }
      const newMoves = [...state.currentMoves, state.newMove];
      await updatePokemon(state.pokemonId, { moves: newMoves });
      clearPendingLearn(sender);
      const newEmoji = TYPE_EMOJIS[state.newMove.type] || "⭐";
      return sock.sendMessage(jid, {
        text: `✅ *${state.pokemonName}* learned *${newEmoji} ${state.newMove.name}*! 🌟\n📖 ${state.newMove.desc || "A powerful new move."}`,
      }, { quoted: msg });
    }

    const slotNum = parseInt(choice);
    if (isNaN(slotNum) || slotNum < 1 || slotNum > state.currentMoves.length) {
      const moveList = state.currentMoves.map((m, i) => {
        const emoji = TYPE_EMOJIS[m.type] || "⭐";
        return `*${i + 1}.* ${emoji} ${m.name} (Power: ${m.power || "—"}, PP: ${m.pp})`;
      }).join("\n");

      const newEmoji = TYPE_EMOJIS[state.newMove.type] || "⭐";
      const timeLeft = Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000));

      return sock.sendMessage(jid, {
        text:
`🌟 *LEARN NEW MOVE!*
*${state.pokemonName}* wants to learn *${state.newMove.name}*!

${newEmoji} *${state.newMove.name}* (Power: ${state.newMove.power || "—"}, PP: ${state.newMove.pp})
📖 ${state.newMove.desc || "A powerful new move."}

*Current Moves:*
${moveList}

Reply *.learnmove <1-6>* to replace a move.
Reply *.learnmove cancel* to keep current moves.
⏳ *${timeLeft}s remaining*`,
      }, { quoted: msg });
    }

    // Replace the chosen move
    const replacedMove = state.currentMoves[slotNum - 1];
    const newMoves = [...state.currentMoves];
    newMoves[slotNum - 1] = state.newMove;

    await updatePokemon(state.pokemonId, { moves: newMoves });
    clearPendingLearn(sender);

    const newEmoji = TYPE_EMOJIS[state.newMove.type] || "⭐";
    return sock.sendMessage(jid, {
      text:
`✅ *${state.pokemonName}* forgot *${replacedMove.name}*
and learned *${newEmoji} ${state.newMove.name}*! 🌟

📖 ${state.newMove.desc || "A powerful new move."}`,
    }, { quoted: msg });
  },
};
