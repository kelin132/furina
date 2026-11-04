import { findOrCreateUser } from "./db.js";
import { formatCardLabel, sendCardMedia } from "../../lib/cardApi.mjs";

export default {
  name: "card",
  aliases: ["viewcard"],
  category: "cards",
  description: "View a card from your collection by index",
  usage: ".card <index>",

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const user = await findOrCreateUser(sender);

      if (!Array.isArray(user.cards) || user.cards.length === 0) {
        return reply(
          `you have no cards yet, collect some from spawns`
        );
      }

      if (!args[0]) {
        return reply(
          `you have \`${user.cards.length}\` cards, use *.col* to view them`
        );
      }

      const index = parseInt(args[0]);
      if (isNaN(index) || index < 1 || index > user.cards.length) {
        return reply(
          `Invalid card, you have \`${user.cards.length}\` cards, type *.col* to check`
        );
      }

      const card  = user.cards[index - 1];
      const isAuctionCard = String(card.spawnId || "").startsWith("web-auction-");
      const priceLabel = isAuctionCard ? "Auction paid" : "Value";
      const priceText = isAuctionCard
        ? `${(Number(card.price) || 0).toLocaleString()} coins`
        : `$${(Number(card.price) || 0).toLocaleString()}`;

      const caption =
`╭─❀「 🎴 *𝐂𝐀𝐑𝐃 𝐕𝐈𝐄𝐖* 」❀─╮
│ ${formatCardLabel(card)}
│
│ 📺 *Series* :: \`${card.series || "Unknown"}\`
│ 🆔 *ID*     :: \`${card.claimId || card.index || index}\`
│ 💎 *${priceLabel}* :: \`${priceText}\`
│
│ 🃏 Card \`#${index}\` of \`${user.cards.length}\`
╰───────────────❀`;

      if (card.media) {
        try {
          return await sendCardMedia(sock, jid, card, caption, { quoted: msg });
        } catch { /* fall through to text */ }
      }

      return reply(caption);

    } catch (err) {
      console.error("CARD ERROR:", err);
      return reply("Failed to show card.");
    }
  },
};
