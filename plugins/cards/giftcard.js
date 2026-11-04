import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";

function resolveTarget(msg) {
  const ctx = msg.message?.extendedTextMessage?.contextInfo
            || msg.message?.imageMessage?.contextInfo
            || msg.message?.videoMessage?.contextInfo
            || {};
  return ctx?.mentionedJid?.[0] || ctx?.participant || ctx?.quotedParticipant || null;
}

export default {
  name: "giftcard",
  aliases: ["gcard", "cgive", "cardgive"],
  category: "cards",
  description: "Gift one of your cards to another user",
  usage: ".giftcard <card index> @user",

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const target = resolveTarget(msg);

      if (!target) {
        return reply(" Mention or reply to the user you want to give your card");
      }

      if (target === sender) return reply(" You can't gift a card to yourself, baka!.");

      const index = parseInt(args[0], 10) - 1;
      if (isNaN(index) || index < 0) return reply(" Usage: .giftcard <card number> @user");

      const [senderUser, targetUser] = await Promise.all([
        findOrCreateUser(sender),
        findOrCreateUser(target),
      ]);

      senderUser.cards = Array.isArray(senderUser.cards) ? senderUser.cards : [];
      targetUser.cards = Array.isArray(targetUser.cards) ? targetUser.cards : [];

      if (senderUser.cards.length === 0) return reply(" You have no cards to gift.");
      if (index >= senderUser.cards.length) return reply(" Invalid card number.");


      const card = senderUser.cards[index];
      if (!card) return reply(" Card not found.");
      if (card.locked || card.inAuction) return reply(" This card is locked or in auction and cannot be gifted.");

      senderUser.cards.splice(index, 1);
      targetUser.cards.push(card);
      senderUser.totalCards = Math.max(0, (senderUser.totalCards || 1) - 1);
      targetUser.totalCards = (targetUser.totalCards || 0) + 1;

      await Promise.all([senderUser.save(), targetUser.save()]);

      return await sock.sendMessage(jid, {
        text:
`🎁 *CARD GIFTED*

${formatCardLabel(card)}

📤 From: @${sender.split("@")[0]}
📥 To: @${target.split("@")[0]}`,
        mentions: [sender, target],
      }, { quoted: msg });

    } catch (err) {
      console.error("GIFTCARD ERROR:", err);
      return reply(" Gift failed. Please try again.");
    }
  },
};
