import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";

export default {
  name: "delc",
  aliases: ["deletecard", "removec"],
  category: "cards",
  description: "Remove a card from your collection by index",
  usage: ".delc <index>",

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      if (!args[0]) {
        return reply("❌ Usage: .delc <card index>\n\nUse .col to see your cards and their indexes.");
      }

      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0) return reply("❌ Invalid card index.");

      const user = await findOrCreateUser(sender);

      if (!Array.isArray(user.cards) || user.cards.length === 0) {
        return reply("❌ You don't have any cards in your collection.");
      }

      if (index >= user.cards.length) {
        return reply(`❌ Invalid index. You only have ${user.cards.length} card(s). Use .col to check.`);
      }

      const card     = user.cards[index];

      user.cards.splice(index, 1);
      user.totalCards = Math.max(0, (user.totalCards || 1) - 1);
      await user.save();

      return reply(
`🗑️ *CARD REMOVED*

${formatCardLabel(card)}

Card permanently removed from your collection.`
      );

    } catch (err) {
      console.error("DELC ERROR:", err);
      return reply("❌ Failed to remove card. Please try again.");
    }
  },
};
