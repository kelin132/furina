/**
 * .ban @user [reason]
 * Permanently block a user from using any bot command.
 * Owner only.
 */
import { banUser, getUser } from "../economy/database.js";
import { generateBanCard } from "../../lib/banCanvas.mjs";
import { getProfilePic } from "../../lib/profileGen.mjs";
import { resolveLidToJid } from "../../lib/identity.mjs";
import { getPermissions, getMods } from "../../lib/permissions.mjs";
import { getBanTargetBlock } from "../../lib/banAuthorization.mjs";

export default {
  name: "ban",
  description: "Ban a regular user from the bot",
  category: "staff",
  usage: ".ban @user [reason]",
  aliases: ["botban", "blockuser"],
  isMod: true,

  async run({ sock, msg, args, sender, isActualOwner, staffLevel = 0 }) {
    const jid = msg.key.remoteJid;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let targetJid = null;

    if (mentioned) {
      targetJid = mentioned;
    } else if (args[0]?.match(/^\d+$/)) {
      targetJid = `${args[0]}@s.whatsapp.net`;
    } else {
      return sock.sendMessage(jid, {
        text: "❓ *Usage:* `.ban @user [reason]`\n\nExample: `.ban @user spamming the bot`",
      }, { quoted: msg });
    }
    targetJid = await resolveLidToJid(targetJid, sock, jid);

    // Cannot ban yourself
    if (targetJid === sender) {
      return sock.sendMessage(jid, { text: "❌ You cannot ban yourself." }, { quoted: msg });
    }

    let target;
    let targetPermissions;
    try {
      [target, targetPermissions] = await Promise.all([
        getUser(targetJid),
        getPermissions(targetJid, "", { sock, chatId: jid }),
      ]);
    } catch {
      return sock.sendMessage(jid, {
        text: "❌ I couldn't verify that user's staff rank. Please try again later.",
      }, { quoted: msg });
    }

    const targetPlatformId = targetJid.startsWith("discord:")
      ? targetJid.slice("discord:".length).split(":")[0]
      : targetJid.split("@")[0].split(":")[0];
    const targetDigits = targetJid.startsWith("discord:")
      ? ""
      : targetPlatformId.replace(/\D/g, "");
    const isModByFile = getMods().some((id) => {
      const normalizedId = String(id);
      return normalizedId === targetJid ||
        normalizedId === targetPlatformId ||
        (targetDigits && normalizedId === targetDigits) ||
        normalizedId === `discord:${targetPlatformId}`;
    });
    const targetBlock = getBanTargetBlock({
      isActualOwner,
      targetIsOwner: targetPermissions.isOwner,
      targetIsMod: targetPermissions.isMod || isModByFile,
      targetStaffLevel: target.staffLevel,
      moderationStatusAvailable: targetPermissions.moderationStatusAvailable,
    });
    if (targetBlock === "staff") {
      return sock.sendMessage(jid, {
        text: "❌ Mods and staff can't ban other mods or staff. Only the configured owner can do that.",
      }, { quoted: msg });
    }
    if (targetBlock === "unavailable") {
      return sock.sendMessage(jid, {
        text: "❌ I couldn't verify that user's staff rank. Please try again later.",
      }, { quoted: msg });
    }

    // Collect reason from remaining args (after the mention/number)
    const reasonArgs = mentioned ? args : args.slice(1);
    const reason     = reasonArgs.join(" ").trim() || "No reason given";

    const bannedBy = isActualOwner
      ? "Owner"
      : Number(staffLevel) >= 3
        ? "Staff Level 3"
        : Number(staffLevel) >= 2
          ? "Staff"
          : "Moderator";

    // Upsert ban (works even if user isn't registered)
    await banUser(targetJid, reason, bannedBy);

    // Try to load user name
    let userName = targetJid.split("@")[0].split(":")[0];
    try {
      if (target?.name) userName = target.name;
    } catch { /* ignore */ }

    const avatarUrl = await getProfilePic(sock, targetJid);

    try {
      const card = await generateBanCard("ban", {
        username:  userName,
        reason,
        bannedBy,
        date:      new Date().toDateString(),
        avatarUrl,
      });

      await sock.sendMessage(jid, {
        image:   card,
        caption: `🚫 *${userName}* has been *banned* from the bot by ${bannedBy}.\n📝 Reason: ${reason}`,
        mentions: [targetJid],
      }, { quoted: msg });
    } catch (err) {
      // Canvas failed — text fallback
      await sock.sendMessage(jid, {
        text:
          `🚫 *User Banned*\n\n` +
          `👤 User   : ${userName}\n` +
          `🛡️ Banned by: ${bannedBy}\n` +
          `📝 Reason : ${reason}\n` +
          `📅 Date   : ${new Date().toDateString()}\n\n` +
          `_User is now blocked from all bot commands._`,
        mentions: [targetJid],
      }, { quoted: msg });
    }
  },
};
