// plugins/pokemon/challengeArena.js
// Create a shared AIDORU web battle arena for a WhatsApp challenge.

import { findTrainerByUsername, getTrainer, pickLeadFromParty } from "../../lib/pokemon/players.mjs";
import { healPartyAndGet } from "../../lib/pokemon/pokemonDb.mjs";
import { createWebBattleRoom, webBattleUrl } from "../../lib/webBattleRoom.mjs";
import { resolveLid } from "../../lib/permissions.mjs";
import { findActivePokemonBattle } from "../../lib/pokemon/activeBattle.mjs";

function normaliseLabel(value) {
  return String(value ?? "")
    .trim()
    .replace(/^@+/, "")
    .split("@", 1)[0]
    .split(":", 1)[0]
    .toLowerCase();
}

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
    message.contextInfo ||
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.audioMessage?.contextInfo ||
    message.documentMessage?.contextInfo ||
    message.buttonsResponseMessage?.contextInfo ||
    message.templateButtonReplyMessage?.contextInfo ||
    null
  );
}

function jidCandidates(jid) {
  const value = String(jid || "");
  if (!value) return [];
  const [local, domain] = value.split("@", 2);
  const bareLocal = (local || "").split(":", 1)[0];
  const candidates = [value];
  if (domain === "s.whatsapp.net" && bareLocal) {
    candidates.push(`${bareLocal}@s.whatsapp.net`);
  }
  return [...new Set(candidates)];
}

async function findTrainerForJid(jid) {
  for (const candidate of jidCandidates(jid)) {
    const trainer = await getTrainer(candidate);
    if (trainer) return trainer;
  }
  return null;
}

async function findGroupMemberByLabel(sock, chatJid, value) {
  const label = normaliseLabel(value);
  if (!label || !chatJid?.endsWith("@g.us")) return null;

  try {
    const metadata = await sock.groupMetadata(chatJid);
    const participant = metadata.participants?.find((entry) =>
      [entry.notify, entry.name, entry.vname, entry.displayName, entry.jid, entry.id, entry.lid]
        .filter(Boolean)
        .some((name) => normaliseLabel(name) === label),
    );
    return participant?.id || participant?.jid || participant?.lid || null;
  } catch {
    return null;
  }
}

export default {
  name: "chweb",
  aliases: ["cha", "chaweb"],
  description: "Open a shared AIDORU web arena with healed parties, moves, items, and live trainer matchmaking",
  category: "pokemon",
  usage: ".chweb @user  OR  .chweb <trainer username>  OR  reply to their message then .chweb",

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;
    const ctx = getContextInfo(msg);
    const mentionedJid = ctx?.mentionedJid?.[0] || null;
    const quotedSender =
      ctx?.participant ||
      ctx?.quotedParticipant ||
      ctx?.quotedMessage?.key?.participant ||
      (msg.quoted?.key?.participant ?? null) ||
      (msg.quoted?.key?.remoteJid && msg.quoted.key.remoteJid !== jid
        ? msg.quoted.key.remoteJid
        : null);

    const rawTargetJid = mentionedJid || quotedSender || null;
    let resolvedRawTargetJid = rawTargetJid;
    if (rawTargetJid?.endsWith("@lid")) {
      const groupMemberJid = await findGroupMemberByLabel(sock, jid, rawTargetJid);
      if (groupMemberJid) {
        resolvedRawTargetJid = groupMemberJid;
      } else {
        const digits = await resolveLid(rawTargetJid, sock, jid);
        resolvedRawTargetJid = digits ? `${digits}@s.whatsapp.net` : null;
      }
    }

    const typedLabel = args.join(" ");
    const typedTarget = typedLabel ? await findTrainerByUsername(typedLabel) : null;
    const groupTarget = !resolvedRawTargetJid && !typedTarget
      ? await findGroupMemberByLabel(sock, jid, typedLabel)
      : null;
    const targetJid =
      resolvedRawTargetJid ||
      typedTarget?.jid ||
      groupTarget ||
      (rawTargetJid && !rawTargetJid.endsWith("@lid") ? rawTargetJid : null);

    if (!targetJid) {
      return sock.sendMessage(
        jid,
        {
          text:
            "Usage:\n" +
            "• *.chweb @user* — challenge that trainer in the web arena\n" +
            "• *.gym @user* — open the same web arena shortcut\n" +
            "• *.chweb <trainer username>* — challenge by trainer username\n" +
            "• Reply to their message then *.chweb*",
        },
        { quoted: msg },
      );
    }

    const sameTrainer =
      targetJid === sender ||
      targetJid.split("@")[0].split(":")[0] === sender.split("@")[0].split(":")[0];
    if (sameTrainer) {
      return sock.sendMessage(jid, { text: "❌ You can't challenge yourself!" }, { quoted: msg });
    }

    const [challenger, opponent] = await Promise.all([
      getTrainer(sender),
      findTrainerForJid(targetJid),
    ]);
    if (!challenger) {
      return sock.sendMessage(
        jid,
        { text: "❌ Start your journey first! Use *.startjourney*" },
        { quoted: msg },
      );
    }

    if (!opponent) {
      return sock.sendMessage(
        jid,
        { text: "❌ That trainer hasn't started their Pokémon journey yet!" },
        { quoted: msg },
      );
    }

    const challengerJid = challenger.jid || sender;
    const opponentJid = opponent.jid || targetJid;

    let activeBattle;
    try {
      const checks = await Promise.all([
        findActivePokemonBattle(challengerJid),
        findActivePokemonBattle(opponentJid),
      ]);
      activeBattle = checks.some(Boolean);
    } catch (error) {
      console.error("[chweb] battle status lookup failed:", error?.message || error);
      return sock.sendMessage(
        jid,
        { text: "⚠️ I couldn't verify both trainers' battle status, so I paused the challenge. Please try again shortly." },
        { quoted: msg },
      );
    }
    if (activeBattle) {
      return sock.sendMessage(
        jid,
        { text: "❌ Both trainers must finish any active Pokémon battle before starting a new web battle." },
        { quoted: msg },
      );
    }

    let party;
    let opponentParty;
    try {
      [party, opponentParty] = await Promise.all([
        healPartyAndGet(challengerJid),
        healPartyAndGet(opponentJid),
      ]);
    } catch (error) {
      console.error("[chweb] unable to heal battle parties:", error?.message || error);
      return sock.sendMessage(
        jid,
        { text: "❌ I couldn't heal both battle parties right now. Please try *.chweb* again." },
        { quoted: msg },
      );
    }

    if (!party.length || !opponentParty.length) {
      return sock.sendMessage(
        jid,
        { text: "❌ Both trainers need at least one Pokémon in their battle party." },
        { quoted: msg },
      );
    }

    const lead = pickLeadFromParty(challenger, party);
    if (!lead || lead.hp <= 0 || !opponentParty.some((pokemon) => pokemon.hp > 0)) {
      return sock.sendMessage(
        jid,
        { text: "❌ Both trainers need at least one Pokémon in their battle party." },
        { quoted: msg },
      );
    }

    await sock.sendMessage(
      jid,
      {
        text:
          "✅ *ALL POKÉMON HAVE BEEN HEALED!*\n\n" +
          "🏟️ Both trainers' battle parties have been loaded into one shared match.\n" +
          "🔗 Preparing your direct Pokémon arena link...",
        mentions: [targetJid],
      },
      { quoted: msg },
    );

    let room;
    try {
      // Do not block room creation on two remote WhatsApp avatar lookups.
      // The web arena can resolve profile images independently after the room opens.
      const challengerAvatarUrl = challenger.avatarUrl || challenger.profilePic || challenger.image || null;
      const opponentAvatarUrl = opponent.avatarUrl || opponent.profilePic || opponent.image || null;
      room = await createWebBattleRoom({
        challengerJid,
        challengerName: challenger.username || msg.pushName || sender.split("@")[0],
        challengerAvatarUrl,
        challengerTrainer: challenger,
        challengerParty: party,
        opponentJid,
        opponentName: opponent.username || targetJid.split("@")[0],
        opponentAvatarUrl,
        opponentTrainer: opponent,
        opponentParty,
      });
    } catch (error) {
      console.error("[chweb] website battle room unavailable:", error?.message || error);
      return sock.sendMessage(
        jid,
        { text: "❌ I couldn't open the web battle arena right now. Please try *.chweb* again." },
        { quoted: msg },
      );
    }

    const url = webBattleUrl(room._id);
    const roomCode = room.code || room._id.slice(-6).toUpperCase();
    const caption =
      `🌐 *POKÉMON BATTLE ARENA READY!*\n\n` +
      `*${challenger.username || msg.pushName || sender.split("@")[0]}* challenged @${targetJid.split("@")[0]}!\n\n` +
      `🔐 *Room code:* \`${roomCode}\`\n` +
      `Open this same link in your signed-in AIDORU accounts to enter the match directly:\n${url}\n\n` +
      `Both trainers' healed parties, lead Pokémon, moves, and items are loaded into this one shared arena. The match starts automatically when the room opens.`;

    return sock.sendMessage(
      jid,
      { text: caption, mentions: [targetJid] },
      { quoted: msg },
    );
  },
};

