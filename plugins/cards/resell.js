/**
 * .resell <index> [amount]
 * Sell one card (or multiple duplicates) back to the bot for 50% of its value.
 * Payout lands in the user's economy wallet.
 */
import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";
import {
  getUser    as getEconomyUser,
  saveUser   as saveEconomyUser,
  addHistory,
  isRegistered,
} from "../economy/database.js";

// Fallback resell prices per tier (used if card.price is missing)
const RESELL_BASE = {
  Common:    200,
  Uncommon:  800,
  Rare:      4000,
  Epic:      15000,
  Legendary: 55000,
};

const PAYOUT_RATE = 0.5; // 50 % of card's stored value
const MAX_RESELLS = 3;
const TIME_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours in milliseconds
const resellTracker = new Map(); // Stores sender -> array of timestamps

export default {
  name:        "resell",
  aliases:     ["sellback", "rsell"],
  category:    "cards",
  description: "Sell a card back to the bot for 50% of its value (Max 3 per 4h)",
  usage:       ".resell <index>",
  cooldown:    5,

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      // ── Validate args ────────────────────────────────────────────────────
      if (!args[0]) {
        return reply(
`💰 *RESELL A CARD*

Sell a card back to the bot for *50%* of its value.
Payout is added to your economy wallet.
⚠️ *Limit:* 3 resells per 4 hours.

📌 Usage: *.resell <index>*
📋 View your cards: *.col*

Example: \`.resell 3\``
        );
      }

      // ── Rate Limit Check (3 resells per 4 hours) ──────────────────────────
      const now = Date.now();
      let userHistory = resellTracker.get(sender) || [];

      // Filter out timestamps older than 4 hours
      userHistory = userHistory.filter((timestamp) => now - timestamp < TIME_WINDOW_MS);

      if (userHistory.length >= MAX_RESELLS) {
        const oldestResell = userHistory[0];
        const resetTime = oldestResell + TIME_WINDOW_MS;
        const remainingMs = resetTime - now;

        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const minutes = Math.ceil((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

        return reply(
          `⏳ *Resell limit reached!*\n\nYou can only resell *${MAX_RESELLS} times every 4 hours*.\n` +
          `Please wait *${hours}h ${minutes}m* before selling another card.`
        );
      }

      const index = parseInt(args[0]) - 1;
      if (isNaN(index) || index < 0) {
        return reply("❌ Invalid index. Use *.col* to see your cards and their numbers.");
      }

      // ── Check economy registration ────────────────────────────────────────
      const registered = await isRegistered(sender);
      if (!registered) {
        return reply("❌ You need an economy account to receive the payout.\n\nUse *.register <your name>* first.");
      }

      // ── Load card user ────────────────────────────────────────────────────
      const cardUser = await findOrCreateUser(sender);

      if (!Array.isArray(cardUser.cards) || cardUser.cards.length === 0) {
        return reply("❌ You don't have any cards to sell.\n\nWait for a spawn and use *.claim <ID>* to collect one!");
      }

      if (index >= cardUser.cards.length) {
        return reply(`❌ Invalid index. You only have *${cardUser.cards.length}* card(s).\nUse *.col* to check.`);
      }

      // ── Calculate payout ──────────────────────────────────────────────────
      const card      = cardUser.cards[index];
      const cardName  = card.name  || "Unknown Card";
      const cardTier  = card.tier  || "Common";
      const baseValue = card.price || RESELL_BASE[cardTier] || 200;
      const payout    = Math.floor(baseValue * PAYOUT_RATE);

      // Record successful resell timestamp
      userHistory.push(now);
      resellTracker.set(sender, userHistory);

      // ── Remove card from collection ───────────────────────────────────────
      cardUser.cards.splice(index, 1);
      cardUser.totalCards = Math.max(0, (cardUser.totalCards || 1) - 1);
      await cardUser.save();

      // ── Credit economy wallet ─────────────────────────────────────────────
      const econUser  = await getEconomyUser(sender);
      econUser.money  = (econUser.money || 0) + payout;
      await saveEconomyUser(sender, econUser);
      await addHistory(sender, "resell", payout, `Sold card: ${cardName}`);

      const remainingResells = MAX_RESELLS - userHistory.length;

      return reply(
`✅ *CARD SOLD!*

${formatCardLabel(card)}
💰 Market Value: $${baseValue.toLocaleString()}

💰 You received: *$${payout.toLocaleString()}* (50%)
   → Added to your wallet

💳 New Balance: $${econUser.money.toLocaleString()}
📊 Resells remaining: *${remainingResells}/${MAX_RESELLS}* (Resets in 4h)

_Tip: Higher rarity cards sell for more. Use .col to see your collection._`
      );

    } catch (err) {
      console.error("RESELL ERROR:", err);
      return reply("❌ Failed to resell card. Please try again.");
    }
  },
};
