import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";
const MAX_DECKS = 10;
const MAX_CARDS_PER_DECK = 12;

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
}

function findDeck(user, name) {
  const wanted = cleanName(name).toLowerCase();
  return (user.decks || []).find((deck) => deck.name.toLowerCase() === wanted);
}

function deckHelp() {
  return `🎴 *DECK BUILDER*

Create named decks from your collection:
• *.deck create <name>*
• *.deck list*
• *.deck add <name> <card number>*
• *.deck show <name>*
• *.deck remove <name> <card number>*
• *.deck delete <name>*

Example: *.deck create Favorites*
Then add a card from your collection with *.deck add Favorites 3*.`;
}

function cardLine(card, index) {
  return `${index + 1}. ${formatCardLabel(card)} — ${card.series || "Unknown"}`;
}

export default {
  name: "deck",
  aliases: ["dk"],
  category: "cards",
  description: "View your cards or create and manage named decks",
  usage: ".deck [page] | .deck create <name> | .deck add <name> <card #>",

  async run({ sock, msg, args, sender }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const user = await findOrCreateUser(sender);
      user.cards = Array.isArray(user.cards) ? user.cards : [];
      user.decks = Array.isArray(user.decks) ? user.decks : [];

      const action = (args[0] || "").toLowerCase();

      if (["help", "commands"].includes(action)) return reply(deckHelp());

      if (action === "create" || action === "new") {
        const name = cleanName(args.slice(1).join(" "));
        if (!name) return reply("❌ Give your deck a name.\n\nUsage: *.deck create <name>*");
        if (user.decks.length >= MAX_DECKS) return reply(`❌ You can have up to ${MAX_DECKS} named decks.`);
        if (findDeck(user, name)) return reply(`❌ A deck named *${name}* already exists.`);

        user.decks.push({ name, cards: [], createdAt: new Date().toISOString() });
        await user.save();
        return reply(`✅ Deck *${name}* created!\n\nAdd cards with *.deck add ${name} <card number>*.`);
      }

      if (action === "list") {
        if (!user.decks.length) return reply(`🎴 You have no named decks yet.\n\n${deckHelp()}`);
        let text = "🎴 *YOUR DECKS*\n\n";
        for (const deck of user.decks) {
          text += `• *${deck.name}* — ${(deck.cards || []).length}/${MAX_CARDS_PER_DECK} cards\n`;
        }
        return reply(`${text}\nUse *.deck show <name>* to open a deck.`);
      }

      if (action === "delete" || action === "remove-deck") {
        const name = cleanName(args.slice(1).join(" "));
        const index = user.decks.findIndex((deck) => deck.name.toLowerCase() === name.toLowerCase());
        if (index < 0) return reply(`❌ Deck *${name || "that"}* was not found.`);
        const removed = user.decks.splice(index, 1)[0];
        await user.save();
        return reply(`🗑️ Deck *${removed.name}* deleted. Your collection is unchanged.`);
      }

      if (action === "add") {
        const cardIndex = parseInt(args[args.length - 1], 10) - 1;
        const name = cleanName(args.slice(1, -1).join(" "));
        const deck = findDeck(user, name);
        if (!deck) return reply(`❌ Deck *${name || "that"}* was not found.\nUse *.deck list*.`);
        if (!Number.isInteger(cardIndex) || cardIndex < 0 || !user.cards[cardIndex]) {
          return reply("❌ Choose a valid card number from *.deck* or *.col*.");
        }
        if ((deck.cards || []).length >= MAX_CARDS_PER_DECK) {
          return reply(`❌ A deck can hold up to ${MAX_CARDS_PER_DECK} cards.`);
        }

        const card = user.cards[cardIndex];
        deck.cards = deck.cards || [];
        deck.cards.push({
          cardId: card.cardId || null,
          name: card.name || "Unknown card",
          tier: card.tier || "Common",
          series: card.series || "Unknown",
          media: card.media || null,
          addedAt: new Date().toISOString(),
        });
        await user.save();
        return reply(`✅ Added *${card.name}* to deck *${deck.name}*.\n\nCards: ${deck.cards.length}/${MAX_CARDS_PER_DECK}`);
      }

      if (action === "remove") {
        const name = cleanName(args.slice(1, -1).join(" "));
        const deck = findDeck(user, name);
        const cardIndex = parseInt(args[args.length - 1], 10) - 1;
        if (!deck) return reply(`❌ Deck *${name || "that"}* was not found.`);
        if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= (deck.cards || []).length) {
          return reply("❌ Choose a valid card number from *.deck show <name>*.");
        }
        const [removed] = deck.cards.splice(cardIndex, 1);
        await user.save();
        return reply(`✅ Removed *${removed.name}* from deck *${deck.name}*.`);
      }

      if (action === "show" || action === "view" || (action && !/^\d+$/.test(action))) {
        const name = cleanName(args.slice(action === "show" || action === "view" ? 1 : 0).join(" "));
        const deck = findDeck(user, name);
        if (!deck) return reply(`❌ Deck *${name || "that"}* was not found.\nUse *.deck list*.`);
        if (!deck.cards?.length) return reply(`🎴 Deck *${deck.name}* is empty.\nAdd cards with *.deck add ${deck.name} <card number>*.`);

        let text = `🎴 *${deck.name.toUpperCase()}*\n`;
        text += `Cards: ${deck.cards.length}/${MAX_CARDS_PER_DECK}\n\n`;
        deck.cards.forEach((card, index) => {
          text += `${cardLine(card, index)}\n`;
        });
        return reply(text.trim());
      }

      if (!user.cards.length) {
        return reply(`❌ You don't have any cards yet.\n\n${deckHelp()}`);
      }

      const limit = 12;
      let page = parseInt(args[0], 10) || 1;
      const totalCards = user.cards.length;
      const totalPages = Math.ceil(totalCards / limit);
      page = Math.max(1, Math.min(page, totalPages));

      const start = (page - 1) * limit;
      const deckSlice = user.cards.slice(start, start + limit);
      const ReadMore = "\u200e".repeat(4001);

      let text = `〔 🎴 *M Y  D E C K* 〕\n`;
      text += `  🌸 *Page ${page}/${totalPages}*  〔 *Total: ${totalCards}* 〕\n`;
      text += ReadMore + "\n";
      text += "  ━━━━━━━━━━━━━━━━━━━━━━━\n\n";

      for (let i = 0; i < deckSlice.length; i++) {
        const card = deckSlice[i];
        text += `  *${start + i + 1}.* ${formatCardLabel(card)}\n`;
        text += `  📺 *${card.series || "Unknown"}*\n\n`;
      }

      if (totalPages > 1) text += "  _Use .deck <page> to see more_\n";
      text += "\n  _Build a named deck with .deck create <name>_";
      return reply(text);
    } catch (err) {
      console.error("DECK ERROR:", err);
      return reply(" Failed to load your deck.");
    }
  },
};