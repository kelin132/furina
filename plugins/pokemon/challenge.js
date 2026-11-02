// plugins/pokemon/challenge.js
// Challenge another trainer to a Pokémon battle.
// Target can be supplied by @mention OR by replying to their message.

import { getTrainer, pickLeadFromParty } from "../../lib/pokemon/players.mjs";
import { getTrainerParty, getPokemonXpNeeded } from "../../lib/pokemon/pokemonDb.mjs";
import {
  setPendingChallenge, getIncomingChallenge,
  clearPendingChallenge, startPvPBattle, hasBattle,
} from "../../lib/pokemon/battleState.mjs";
import { generateBattleScene } from "../../lib/pokemon/canvas.mjs";
import { generateChallengeCanvas } from "../../lib/pokemon/challengeCanvas.mjs";
import { challengeMentionJid, resolveChallengeTarget } from "../../lib/pokemon/challengeTarget.mjs";

function unwrapMessage(message) {
  let current = message || {};
  for (let index = 0; index < 5; index += 1) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function getContextInfo(msg) {
  const message = unwrapMessage(msg.message);
  return (
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.stickerMessage?.contextInfo ||
    message.buttonsResponseMessage?.contextInfo ||
    null
  );
}

export default {
  name: "challenge",
  aliases: ["ch", "cha", "pvp", "pokebattle"],
  description: "Challenge a user to a Pokémon battle, or accept an incoming challenge",
  category: "pokemon",
  usage: ".ch @user  OR  reply to their message then .ch  |  .ch accept",

  async run({ sock, msg, sender, args, text }) {
    const jid = msg.key.remoteJid;

    // ── Accept incoming challenge ──────────────────────────────────────────────
    if ((args[0] || "").toLowerCase() === "accept") {
      const incoming = getIncomingChallenge(sender);
      if (!incoming) {
        return sock.sendMessage(jid, {
          text: "❌ You have no pending challenge to accept!",
        }, { quoted: msg });
      }

      if (hasBattle(jid)) {
        return sock.sendMessage(jid, { text: "⚔️ A battle is already happening here!" }, { quoted: msg });
      }

      const challengerTrainer = await getTrainer(incoming.challengerJid);
      const opponentTrainer   = await getTrainer(sender);
      if (!challengerTrainer || !opponentTrainer) {
        return sock.sendMessage(jid, { text: "❌ One of the trainers hasn't started their journey!" }, { quoted: msg });
      }

      const challengerParty = await getTrainerParty(incoming.challengerJid);
      const opponentParty   = await getTrainerParty(sender);

      const challengerLead = pickLeadFromParty(challengerTrainer, challengerParty);
      const opponentLead   = pickLeadFromParty(opponentTrainer,   opponentParty);

      if (!challengerLead || challengerLead.hp <= 0 || !opponentLead || opponentLead.hp <= 0) {
        clearPendingChallenge(incoming.challengerJid);
        return sock.sendMessage(jid, {
          text: "❌ One of the trainers has no healthy Pokémon! Use *.heal* first.",
        }, { quoted: msg });
      }

      clearPendingChallenge(incoming.challengerJid);

      const battle = startPvPBattle(jid,
        { jid: incoming.challengerJid, username: challengerTrainer.username, pokemon: challengerLead },
        { jid: sender, username: opponentTrainer.username || msg.pushName, pokemon: opponentLead }
      );

      const moveList = (pokemon) =>
        (pokemon.moves || []).map((m, i) => `  *${i + 1}.* ${m.name} (Power: ${m.power || "—"})`).join("\n");

      let buf;
      try {
        buf = await generateBattleScene({
          round: 1,
          arenaId: battle.arenaId,
          weather: battle.weather,
          player: {
            name: challengerLead.displayName || challengerLead.name,
            pokedexId: challengerLead.pokedexId,
            level: challengerLead.level,
            hp: challengerLead.hp,
            maxHp: challengerLead.maxHp,
            imageUrl: challengerLead.backImageUrl || challengerLead.imageUrl,
            shiny: challengerLead.shiny,
            trainer: battle.challengerTrainer,
          },
          enemy: {
            name: opponentLead.displayName || opponentLead.name,
            pokedexId: opponentLead.pokedexId,
            level: opponentLead.level,
            hp: opponentLead.hp,
            maxHp: opponentLead.maxHp,
            imageUrl: opponentLead.imageUrl,
            shiny: opponentLead.shiny,
            trainer: battle.opponentTrainer,
          },
          round: 1,
          statusText: `${challengerTrainer.username} vs ${opponentTrainer.username || msg.pushName}!`,
        });
      } catch {}

      const caption =
`⚔️ *${challengerTrainer.username}'S TURN!*

🔵 ${challengerTrainer.username}: *${challengerLead.displayName || challengerLead.name}* Lv.${challengerLead.level} ❤️${challengerLead.hp}/${challengerLead.maxHp}
✨ XP: ${challengerLead.xp || 0}/${getPokemonXpNeeded(challengerLead.level) || "MAX LEVEL"}
🔴 ${opponentTrainer.username || msg.pushName}: *${opponentLead.displayName || opponentLead.name}* Lv.${opponentLead.level} ❤️${opponentLead.hp}/${opponentLead.maxHp}
✨ XP: ${opponentLead.xp || 0}/${getPokemonXpNeeded(opponentLead.level) || "MAX LEVEL"}

*Battle Commands:*
⚔️ \`.battle fight\` — See your moves
⚔️ \`.battle switch\` — Switch Pokémon
💊 \`.battle item <item>\` — Use a heal item
🏃 \`.battle run\` — Forfeit`;

      if (buf) {
        await sock.sendMessage(jid, { image: buf, caption }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { text: caption }, { quoted: msg });
      }
      return;
    }

    // ── Resolve opponent ───────────────────────────────────────────────────────
    // Priority 1: @mention in the command message
    // Priority 2: sender of the message being replied to
    const ctx = getContextInfo(msg);
    const mentionedJid = ctx?.mentionedJid?.[0] || null;
    const quotedSender =
      ctx?.participant ||                         // group quoted sender
      ctx?.quotedParticipant ||                   // alternate Baileys field
      (msg.quoted?.key?.participant ?? null) ||   // Baileys quoted key (group)
      (msg.quoted?.key?.remoteJid !== jid         // DM: quoted sender ≠ group jid
        ? msg.quoted?.key?.remoteJid
        : null);

    const rawTargetJid = mentionedJid || quotedSender || null;
    const targetJid = await resolveChallengeTarget({ jid: rawTargetJid, sock, chatJid: jid });
    const targetMentionJid = challengeMentionJid(rawTargetJid, targetJid);

    if (!targetJid) {
      return sock.sendMessage(jid, {
        text:
          "Usage:\n" +
          "• *.ch @user* — mention the trainer you want to challenge\n" +
          "• Reply to their message then *.ch*\n" +
          "• *.ch accept* — accept a challenge sent to you",
      }, { quoted: msg });
    }

    if (targetJid === sender) {
      return sock.sendMessage(jid, { text: "❌ You can't challenge yourself!" }, { quoted: msg });
    }

    const challenger = await getTrainer(sender);
    if (!challenger) {
      return sock.sendMessage(jid, { text: "❌ Start your journey first! Use *.startjourney*" }, { quoted: msg });
    }

    const opponent = await getTrainer(targetJid);
    if (!opponent) {
      return sock.sendMessage(jid, { text: "❌ That trainer hasn't started their Pokémon journey yet!" }, { quoted: msg });
    }

    const party = await getTrainerParty(sender);
    const lead  = pickLeadFromParty(challenger, party);
    if (!lead || lead.hp <= 0) {
      return sock.sendMessage(jid, {
        text: "💔 All your Pokémon have fainted! Use *.heal* first.",
      }, { quoted: msg });
    }

    setPendingChallenge(sender, targetJid, jid, lead);

    const [challengerAvatarUrl, opponentAvatarUrl] = await Promise.all([
      sock.profilePictureUrl(sender, "image").catch(() => null),
      sock.profilePictureUrl(targetJid, "image").catch(() => null),
    ]);

    let challengeImage;
    try {
      challengeImage = await generateChallengeCanvas({
        challenger: {
          name: challenger.username || msg.pushName || sender.split("@")[0],
          avatarUrl: challengerAvatarUrl,
        },
        opponent: {
          name: `@${targetMentionJid.split("@")[0]}`,
          avatarUrl: opponentAvatarUrl,
        },
      });
    } catch {
      challengeImage = null;
    }

    const caption =
      `⚔️ *BATTLE CHALLENGE!*\n\n` +
      `*${challenger.username}* challenges @${targetMentionJid.split("@")[0]} to a Pokémon battle!\n\n` +
      `🐉 Their lead: *${lead.displayName}* Lv.${lead.level}\n\n` +
      `Type *.ch accept* to accept within 2 minutes!`;

    if (challengeImage) {
      await sock.sendMessage(jid, {
        image: challengeImage,
        caption,
        mentions: [targetMentionJid],
      }, { quoted: msg });
    } else {
      await sock.sendMessage(jid, {
        text: caption,
        mentions: [targetMentionJid],
      }, { quoted: msg });
    }
  },
};
