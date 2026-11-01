import { resolveGroupActionJids } from "../../lib/groupIdentity.mjs";

export default {
  name: "demote",
  description: "Demote an admin to regular member",
  category: "group",
  usage: ".demote @user  |  reply to their message + .demote",
  aliases: [],
  cooldown: 3,
  isOwner: false,
  isAdmin: true,
  isPremium: false,
  version: "1.2.0",

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;

    if (!jid.endsWith("@g.us")) {
      return await sock.sendMessage(jid, {
        text: "❌ This command can only be used in groups.",
      }, { quoted: msg });
    }

    // Support: @mention OR replying to their message
    const mentioned    = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const identities   = mentioned.length ? mentioned : quotedSender ? [quotedSender] : [];

    if (!identities.length) {
      return await sock.sendMessage(jid, {
        text: "❌ Mention a user or reply to their message to demote them.\nExample: *.demote @user*  or reply to a message and type *.demote*",
      }, { quoted: msg });
    }

    let targets;
    try {
      targets = await resolveGroupActionJids(sock, jid, identities);
      await sock.groupParticipantsUpdate(jid, targets, "demote");

      const nameList = targets.map(t => `@${t.split("@")[0]}`).join(", ");
      await sock.sendMessage(jid, {
        text: `✅ ${nameList} has been demoted from admin.`,
        mentions: targets,
      }, { quoted: msg });
    } catch (err) {
      console.error("[demote] Could not demote group participant:", err);
      await sock.sendMessage(jid, {
        text: err.message?.includes("could not be resolved")
          ? "❌ I couldn't match that user to a current group member. Mention them or reply to their message and try again."
          : "❌ Failed to demote. Make sure I'm an admin and have the required permissions.",
      }, { quoted: msg });
    }
  },
};
