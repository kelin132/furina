import { getGroupMetadata, groupRoles, personalJid } from "../../lib/groupIdentity.mjs";
import { getQuotedContext } from "../../lib/quotedMedia.mjs";

function quotedMessageKey(jid, context, fromMe) {
  if (!context?.stanzaId) return null;
  return {
    remoteJid: jid,
    id: context.stanzaId,
    fromMe,
    ...(jid.endsWith("@g.us") && context.participant
      ? { participant: context.participant }
      : {}),
  };
}

function isBotMessage(sock, participant) {
  const quotedSender = personalJid(participant);
  if (!quotedSender) return false;
  return [sock.user?.id, sock.user?.jid, sock.user?.lid]
    .map(personalJid)
    .filter(Boolean)
    .includes(quotedSender);
}

export default {
  name: "delete",
  description: "Delete a replied-to message",
  category: "utilities",
  usage: ".delete (reply to a message)",
  aliases: ["del", "dlt"],
  cooldown: 1,
  isAdmin: true,

  async run({ sock, msg, isOwner }) {
    const jid = msg.key.remoteJid;
    const quoted = getQuotedContext(msg);
    const quotedFromBot = isBotMessage(sock, quoted?.context?.participant);
    const key = quotedMessageKey(jid, quoted?.context, quotedFromBot);
    if (!quoted || !key) {
      return sock.sendMessage(jid, {
        text: "Reply to a message to delete it.",
      }, { quoted: msg });
    }

    if (jid.endsWith("@g.us")) {
      // A creator may always remove the bot's own quoted message. This
      // mirrors WhatsApp's own-message delete path without requiring admin.
      if (quotedFromBot && isOwner) {
        await sock.sendMessage(jid, { delete: key });
        if (msg.key.fromMe) await sock.sendMessage(jid, { delete: msg.key });
        return;
      }

      try {
        const metadata = await getGroupMetadata(sock, jid);
        const roles = await groupRoles(
          sock,
          metadata,
          msg.key.participant || msg.key.remoteJid,
          msg.key.participantAlt || msg.key.remoteJidAlt || "",
        );
        if (!roles.senderIsAdmin) {
          return sock.sendMessage(jid, { text: "You're not an admin." }, { quoted: msg });
        }
        if (!roles.botIsAdmin) {
          return sock.sendMessage(jid, { text: "I'm not an admin." }, { quoted: msg });
        }
      } catch {
        return sock.sendMessage(jid, {
          text: "I couldn't verify the group admin permissions. Please try again.",
        }, { quoted: msg });
      }

      await sock.sendMessage(jid, { delete: key });
      return sock.sendMessage(jid, { delete: msg.key });
    }

    if (!isOwner) {
      return sock.sendMessage(jid, { text: "I don't know you." }, { quoted: msg });
    }
    await sock.sendMessage(jid, { delete: key });
    if (msg.key.fromMe) return sock.sendMessage(jid, { delete: msg.key });
  },
};
