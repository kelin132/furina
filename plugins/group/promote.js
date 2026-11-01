import { resolveGroupActionJids } from "../../lib/groupIdentity.mjs";

export default {
  name: "promote",
  description: "Promote a member to admin",
  category: "group",
  usage: ".promote @user  |  reply to their message + .promote",
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
        text: "❌ Mention a user or reply to their message to promote them.\nExample: *.promote @user*  or reply to a message and type *.promote*",
      }, { quoted: msg });
    }

    let targets;
    try {
      targets = await resolveGroupActionJids(sock, jid, identities);
      await sock.groupParticipantsUpdate(jid, targets, "promote");

      const nameList = targets.map(t => `@${t.split("@")[0]}`).join(", ");
      await sock.sendMessage(jid, {
        text: `✅ ${nameList} has been promoted to admin.`,
        mentions: targets,
      }, { quoted: msg });
    } catch (err) {
      console.error("[promote] Could not promote group participant:", err);
      await sock.sendMessage(jid, {
        text: err.message?.includes("could not be resolved")
          ? "❌ I couldn't match that user to a current group member. Mention them or reply to their message and try again."
          : "❌ Failed to promote. Make sure I'm an admin and have the required permissions.",
      }, { quoted: msg });
    }
  },
};
