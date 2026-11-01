/**
 * .jail @user [duration]
 * Put a player in jail. Jailed players cannot use bot commands.
 * Duration examples: 1h, 30m, 2d. Omit for indefinite.
 * Staff-immune players cannot be jailed.
 */
import { jailUser, getUser, isRegistered, addHistory } from "../economy/database.js";
import { resolveLidToJid } from "../../lib/identity.mjs";

function parseDuration(str) {
  if (!str) return 0;
  const match = str.match(/^(\d+)(m|h|d)$/i);
  if (!match) return 0;
  const n    = parseInt(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === "m") return n * 60 * 1000;
  if (unit === "h") return n * 60 * 60 * 1000;
  if (unit === "d") return n * 24 * 60 * 60 * 1000;
  return 0;
}

export default {
  name: "jail",
  description: "Jail a player (blocks all bot commands)",
  category: "staff",
  usage: ".jail @user [1h|30m|2d]",
  aliases: ["jailplayer"],
  isMod: true,

  async run({ sock, msg, args, isOwner, staffLevel }) {
    const jid = msg.key.remoteJid;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let targetJid = null;

    if (mentioned) {
      targetJid = mentioned;
    } else if (args[0]?.match(/^[0-9]+$/)) {
      targetJid = `${args[0]}@s.whatsapp.net`;
    } else {
      return sock.sendMessage(jid, {
        text:
          "❓ *Usage:* `.jail @user [duration]`\n\n" +
          "*Duration examples:*\n• `30m` — 30 minutes\n• `2h` — 2 hours\n• `1d` — 1 day\n• _(omit for indefinite)_"
      }, { quoted: msg });
    }
    targetJid = await resolveLidToJid(targetJid, sock, jid);

    if (!await isRegistered(targetJid)) {
      return sock.sendMessage(jid, { text: "❌ That player is not registered." }, { quoted: msg });
    }

    const target = await getUser(targetJid);

    // Cannot jail staff-immune players unless you're owner
    if (target.staffImmunity && !isOwner) {
      return sock.sendMessage(jid, {
        text: `❌ *${target.name}* has staff immunity and cannot be jailed.`
      }, { quoted: msg });
    }

    // Cannot jail someone of equal or higher staff level
    if (!isOwner && (target.staffLevel || 0) >= staffLevel) {
      return sock.sendMessage(jid, {
        text: "❌ You cannot jail someone at or above your staff level."
      }, { quoted: msg });
    }

    // Parse duration from last arg (if it looks like a duration)
    const lastArg    = args[args.length - 1] || "";
    const durationMs = parseDuration(lastArg);
    const durationStr = durationMs > 0
      ? lastArg.toUpperCase()
      : "Indefinite";

    await jailUser(targetJid, durationMs);
    await addHistory(targetJid, "jail", 0, `Jailed for ${durationStr}`);

    await sock.sendMessage(jid, {
      text:
        `🔒 *Player Jailed*\n\n` +
        `👤 Player   : ${target.name}\n` +
        `⏳ Duration : ${durationStr}\n\n` +
        `_All bot commands are blocked until they are released or their sentence expires._`,
      mentions: [targetJid],
    }, { quoted: msg });
  }
};
