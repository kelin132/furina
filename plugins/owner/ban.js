/**
 * .ban @user [reason]
 * Permanently block a user from using any bot command.
 * Owner only.
 */
import { banUser, getUser, isRegistered } from "../economy/database.js";
import { generateBanCard } from "../../lib/banCanvas.mjs";
import { getProfilePic } from "../../lib/profileGen.mjs";
import { resolveLidToJid } from "../../lib/identity.mjs";

export default {
  name: "ban",
  description: "Permanently ban a user from the bot",
  category: "owner",
  usage: ".ban @user [reason]",
  aliases: ["botban", "blockuser"],
  isOwner: true,

  async run({ sock, msg, args, sender }) {
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

    // Collect reason from remaining args (after the mention/number)
    const reasonArgs = mentioned ? args : args.slice(1);
    const reason     = reasonArgs.join(" ").trim() || "No reason given";

    // Upsert ban (works even if user isn't registered)
    await banUser(targetJid, reason, "Owner");

    // Try to load user name
    let userName = targetJid.split("@")[0].split(":")[0];
    try {
      const user = await getUser(targetJid);
      if (user?.name) userName = user.name;
    } catch { /* ignore */ }

    const avatarUrl = await getProfilePic(sock, targetJid);

    try {
      const card = await generateBanCard("ban", {
        username:  userName,
        reason,
        bannedBy:  "Owner",
        date:      new Date().toDateString(),
        avatarUrl,
      });

      await sock.sendMessage(jid, {
        image:   card,
        caption: `🚫 *${userName}* has been *banned* from the bot.\n📝 Reason: ${reason}`,
        mentions: [targetJid],
      }, { quoted: msg });
    } catch (err) {
      // Canvas failed — text fallback
      await sock.sendMessage(jid, {
        text:
          `🚫 *User Banned*\n\n` +
          `👤 User   : ${userName}\n` +
          `📝 Reason : ${reason}\n` +
          `📅 Date   : ${new Date().toDateString()}\n\n` +
          `_User is now blocked from all bot commands._`,
        mentions: [targetJid],
      }, { quoted: msg });
    }
  },
};
