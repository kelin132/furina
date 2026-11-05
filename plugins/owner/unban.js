/**
 * .unban @user
 * Restore a banned user's access to the bot.
 * Owner only.
 */
import { unbanUser, getUser } from "../economy/database.js";
import { generateBanCard } from "../../lib/banCanvas.mjs";
import { getProfilePic } from "../../lib/profileGen.mjs";
import { resolveLidToJid } from "../../lib/identity.mjs";

export default {
  name: "unban",
  description: "Restore a banned user's bot access",
  category: "owner",
  usage: ".unban @user",
  aliases: ["botunban", "unblockuser"],
  isStaff: true, 
  isMod: true,

  async run({ sock, msg, args }) {
    const jid = msg.key.remoteJid;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let targetJid = null;

    if (mentioned) {
      targetJid = mentioned;
    } else if (args[0]?.match(/^\d+$/)) {
      targetJid = `${args[0]}@s.whatsapp.net`;
    } else {
      return sock.sendMessage(jid, {
        text: "❓ *Usage:* `.unban @user`",
      }, { quoted: msg });
    }
    targetJid = await resolveLidToJid(targetJid, sock, jid);

    // Load user info before clearing ban
    let userName = targetJid.split("@")[0].split(":")[0];
    let wasBanned = false;
    try {
      const user = await getUser(targetJid);
      if (user?.name)   userName = user.name;
      if (user?.banned) wasBanned = true;
    } catch { /* ignore */ }

    if (!wasBanned) {
      return sock.sendMessage(jid, {
        text: `❌ *${userName}* is not currently banned.`,
        mentions: [targetJid],
      }, { quoted: msg });
    }

    await unbanUser(targetJid);

    const avatarUrl = await getProfilePic(sock, targetJid);

    try {
      const card = await generateBanCard("unban", {
        username:  userName,
        bannedBy:  "Owner",
        date:      new Date().toDateString(),
        avatarUrl,
      });

      await sock.sendMessage(jid, {
        image:   card,
                  caption: `✅ *${userName}* has been *unbanned*. Bot access restored; website access was not changed.`,

        mentions: [targetJid],
      }, { quoted: msg });
    } catch {
      await sock.sendMessage(jid, {
        text:
          `✅ *User Unbanned*\n\n` +
          `👤 User   : ${userName}\n` +
          `📅 Date   : ${new Date().toDateString()}\n\n` +
          `_Bot access has been restored. Use .restore to restore website access separately._`,
        mentions: [targetJid],
      }, { quoted: msg });
    }
  },
};
