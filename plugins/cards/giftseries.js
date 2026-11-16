import { findOrCreateUser, uid } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";
import { normalizeJid } from "../../lib/identity.mjs";
import { selectSeriesCards } from "../../lib/cardSeriesTransfer.mjs";

function resolveTarget(msg) {
  const context = msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo
    || {};
  return context.mentionedJid?.[0] || context.participant || context.quotedParticipant || null;
}

function seriesQuery(args) {
  return (Array.isArray(args) ? args : [])
    .join(" ")
    .replace(/@[\w.+-]+/g, "")
    .trim();
}

export default {
  name: "giftseries",
  aliases: ["seriesgift", "gseries"],
  category: "cards",
  description: "Gift your cards from a series to another player",
  usage: ".giftseries <series name> @user",
  cooldown: 5,

  async run({ sock, msg, args, sender }) {
    const jid = msg.key.remoteJid;
    const reply = (text, extra = {}) =>
      sock.sendMessage(jid, { text, ...extra }, { quoted: msg });
    const target = resolveTarget(msg);
    const query = seriesQuery(args);

    if (!target) return reply("❌ Mention or reply to the player receiving the cards.");
    if (normalizeJid(target) === normalizeJid(sender)) {
      return reply("❌ You cannot gift cards to yourself.");
    }
    if (!query) {
      return reply("❌ Usage: *.giftseries <series name> @user*");
    }

    try {
      const senderUser = await findOrCreateUser(sender);
      const selection = selectSeriesCards(senderUser.cards, query);
      if (selection.status === "missing") {
        return reply(`❌ You do not own any cards from a series matching *${query}*.`);
      }
      if (selection.status === "ambiguous") {
        return reply(
          `❌ *${query}* matches several series. Use a more specific name:\n\n` +
          selection.matches.slice(0, 12).map((name) => `• ${name}`).join("\n"),
        );
      }
      if (!selection.eligible.length) {
        return reply(
          `❌ Your *${selection.series}* cards are locked or listed in an auction, so none can be gifted.`,
        );
      }

      const recipient = await findOrCreateUser(target);
      recipient.cards = Array.isArray(recipient.cards) ? recipient.cards : [];
      const gifted = selection.eligible;
      const senderOriginalCards = [...senderUser.cards];
      const recipientOriginalCards = [...recipient.cards];
      const giftedSet = new Set(gifted);

      senderUser.cards = senderUser.cards.filter((card) => !giftedSet.has(card));
      senderUser.totalCards = senderUser.cards.length;
      recipient.cards.push(...gifted);
      recipient.totalCards = recipient.cards.length;

      try {
        await senderUser.save();
      } catch (error) {
        senderUser.cards = senderOriginalCards;
        senderUser.totalCards = senderOriginalCards.length;
        await senderUser.save().catch((rollbackError) => {
          console.error("GIFTSERIES SOURCE RESTORE ERROR:", rollbackError);
        });
        throw error;
      }

      try {
        await recipient.save();
      } catch (error) {
        recipient.cards = recipientOriginalCards;
        recipient.totalCards = recipientOriginalCards.length;
        try {
          await recipient.save();
        } catch (rollbackError) {
          console.error("GIFTSERIES RECIPIENT RESTORE ERROR:", rollbackError);
          throw new Error("Recipient collection changed during the transfer; check both collections before retrying.", {
            cause: error,
          });
        }
        senderUser.cards = senderOriginalCards;
        senderUser.totalCards = senderOriginalCards.length;
        await senderUser.save().catch((rollbackError) => {
          console.error("GIFTSERIES SENDER RESTORE ERROR:", rollbackError);
          throw new Error("Sender collection could not be restored after the transfer failed.", {
            cause: error,
          });
        });
        throw error;
      }

      const preview = gifted.slice(0, 10).map((card) => `• ${formatCardLabel(card)}`).join("\n");
      const extraCount = gifted.length - Math.min(gifted.length, 10);
      const blockedText = selection.blocked.length
        ? `\n\n⚠️ ${selection.blocked.length} locked or auction card(s) stayed in your collection.`
        : "";

      return reply(
`🎁 *SERIES GIFT SENT*

📚 Series: *${selection.series}*
🃏 Cards gifted: *${gifted.length}*
📤 From: @${uid(sender)}
📥 To: @${uid(target)}

${preview}${extraCount > 0 ? `\n• ...and ${extraCount} more` : ""}${blockedText}`,
        { mentions: [sender, target] },
      );
    } catch (error) {
      console.error("GIFTSERIES ERROR:", error);
      return reply("❌ The series gift could not be completed. Your collection was not intentionally changed; try again.");
    }
  },
};
