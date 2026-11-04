/**
 * .auction <index> [starting price]
 * List a card for a live 90-second group auction.
 * Other players bid with .bid <amount>.
 */
import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";
import {
  hasAuction, setAuction, deleteAuction, getAuction, withAuctionLock, withBidderLock,
} from "../../lib/auctionManager.mjs";
import {
  isRegistered,
  addHistory,
  addMoney,
  debitWalletIfAvailable,
  clearAuctionHold,
} from "../economy/database.js";

const DURATION_MS  = 90_000; // 90 seconds
const RESELL_BASE  = { Common: 200, Uncommon: 800, Rare: 4000, Epic: 15000, Legendary: 55000 };
const MIN_START    = 50;

export async function closeAuction(groupJid) {
  const scheduledAuction = getAuction(groupJid);
  if (!scheduledAuction) return;

  const settle = () => withAuctionLock(groupJid, async () => {
    // A second close callback may have queued while the first one was settling.
    if (getAuction(groupJid) !== scheduledAuction) return;
    deleteAuction(groupJid);

    const { sock, card, sellerJid, currentBid, currentBidder } = scheduledAuction;
    const auctionId = scheduledAuction.auctionId || `whatsapp:${groupJid}`;

    // ── No bids — return card to seller ────────────────────────────────────
    if (!currentBidder) {
      try {
        const sellerCards = await findOrCreateUser(sellerJid);
        sellerCards.cards.push(card);
        sellerCards.totalCards = (sellerCards.totalCards || 0) + 1;
        await sellerCards.save();
      } catch { /* best-effort */ }

      return sock.sendMessage(groupJid, {
        text: [
          `🔨 *AUCTION ENDED — NO BIDS*`,
          ``,
          formatCardLabel(card),
          ``,
          `Nobody placed a bid. The card has been returned to the seller.`,
        ].join("\n"),
      });
    }

    let debited = false;
    let cardTransferred = false;
    try {
      const payment = await debitWalletIfAvailable(currentBidder, currentBid);
      if (!payment) {
        const sellerCards = await findOrCreateUser(sellerJid);
        sellerCards.cards.push(card);
        sellerCards.totalCards = (sellerCards.totalCards || 0) + 1;
        await sellerCards.save();
        await sock.sendMessage(groupJid, {
          text: `❌ The highest bidder no longer has $${currentBid.toLocaleString()} available. The card has been returned to the seller; no money was charged.`,
          mentions: [currentBidder, sellerJid],
        });
        return;
      }
      debited = true;

      const winnerCards = await findOrCreateUser(currentBidder);
      winnerCards.cards.push({ ...card, obtainedAt: new Date().toISOString() });
      winnerCards.totalCards = (winnerCards.totalCards || 0) + 1;
      await winnerCards.save();
      cardTransferred = true;

      await addMoney(sellerJid, currentBid);
      await addHistory(sellerJid, "auction_sold", currentBid, `Sold card at auction: ${card.name}`);
      await addHistory(currentBidder, "auction_bought", -currentBid, `Bought card at auction: ${card.name}`);

      const winnerNum = currentBidder.split("@")[0].split(":")[0];
      const sellerNum = sellerJid.split("@")[0].split(":")[0];

      await sock.sendMessage(groupJid, {
        text: [
          `🔨 *AUCTION SOLD!*`,
          ``,
          formatCardLabel(card),
          ``,
          `🏆 Winner : @${winnerNum}`,
          `💰 Paid   : $${currentBid.toLocaleString()}`,
          `📤 Seller : @${sellerNum} received $${currentBid.toLocaleString()}`,
          ``,
          `Congratulations! Use *.col* to see your new card.`,
        ].join("\n"),
        mentions: [currentBidder, sellerJid],
      });
    } catch (err) {
      console.error("AUCTION CLOSE ERROR:", err);
      if (debited && !cardTransferred) {
        try {
          await addMoney(currentBidder, currentBid);
          await addHistory(currentBidder, "auction_refund", currentBid, `Refund for failed auction: ${card.name}`);
        } catch (refundError) {
          console.error("AUCTION BID REFUND ERROR:", refundError);
        }
      }
      await sock.sendMessage(groupJid, {
        text: cardTransferred
          ? "⚠️ The card was delivered, but seller payment did not fully complete. Please contact an admin."
          : "❌ Auction settlement failed. Please contact an admin.",
      });
    } finally {
      if (currentBidder) {
        await clearAuctionHold(currentBidder, auctionId).catch((error) => {
          console.error("[auction] Could not clear settled bidder hold:", error);
        });
      }
    }
  });

  // Keep transfers queued until the winner is charged and the auction is
  // removed; this closes the race between the timer and a simultaneous .give.
  return scheduledAuction.currentBidder
    ? withBidderLock(scheduledAuction.currentBidder, settle)
    : settle();
}

export default {
  name:        "auction",
  aliases:     ["auc", "cardauction"],
  category:    "cards",
  description: "Start a live 90-second auction for one of your cards",
  usage:       ".auction <index> [starting price]",
  cooldown:    5,

  async run({ sock, msg, args, sender }) {
    const groupJid = msg.key.remoteJid;
    const reply    = (text) => sock.sendMessage(groupJid, { text }, { quoted: msg });

    if (!groupJid.endsWith("@g.us")) {
      return reply("❌ Auctions can only be started in groups.");
    }

    if (!args[0]) {
      return reply(
        `🔨 *CARD AUCTION*\n\n` +
        `List a card for a live 90-second auction. Anyone can bid!\n\n` +
        `📌 Usage: *.auction <index> [starting price]*\n` +
        `📋 View your cards: *.col*\n\n` +
        `Example: \`.auction 3 500\``
      );
    }

    if (hasAuction(groupJid)) {
      const a    = getAuction(groupJid);
      const secs = Math.max(0, Math.ceil((a.endsAt - Date.now()) / 1000));
      return reply(`⏳ An auction is already running in this group!\n\n🃏 *${a.card.name}* —${secs}s left\n\nUse *.bid <amount>* to place a bid.`);
    }

    if (!await isRegistered(sender)) {
      return reply("❌ You need an economy account to run auctions.\n\nUse *.register <your name>* first.");
    }

    const cardIndex = parseInt(args[0]) - 1;
    if (isNaN(cardIndex) || cardIndex < 0) {
      return reply("❌ Invalid card index. Use *.col* to see your cards.");
    }

    const cardUser = await findOrCreateUser(sender);
    if (!Array.isArray(cardUser.cards) || cardUser.cards.length === 0) {
      return reply("❌ You don't have any cards to auction.");
    }
    if (cardIndex >= cardUser.cards.length) {
      return reply(`❌ You only have *${cardUser.cards.length}* card(s). Use *.col* to check.`);
    }

    const card      = cardUser.cards[cardIndex];
    const baseValue = card.price || RESELL_BASE[card.tier] || 200;

    let startBid = args[1] ? parseInt(args[1]) : Math.floor(baseValue * 0.3);
    if (isNaN(startBid) || startBid < MIN_START) startBid = MIN_START;

    // Remove card from seller
    cardUser.cards.splice(cardIndex, 1);
    cardUser.totalCards = Math.max(0, (cardUser.totalCards || 1) - 1);
    await cardUser.save();

    const endsAt = Date.now() + DURATION_MS;
    const timer  = setTimeout(() => closeAuction(groupJid), DURATION_MS);

    setAuction(groupJid, {
      groupJid,
      auctionId: `whatsapp:${groupJid}`,
      sellerJid:     sender,
      card,
      startBid,
      currentBid:    0,
      currentBidder: null,
      endsAt,
      timer,
      sock,
    });

    const sellerNum = sender.split("@")[0].split(":")[0];

    return sock.sendMessage(groupJid, {
      text: [
        `🔨 *CARD AUCTION STARTED!*`,
        ``,
        formatCardLabel(card),
        `📺 Series : ${card.series || "Unknown"}`,
        ``,
        `💰 Starting bid : $${startBid.toLocaleString()}`,
        `📤 Seller       : @${sellerNum}`,
        `⏱️ Time left     : 90 seconds`,
        ``,
        `Type *.bid <amount>* to place your bid!`,
        `Highest bid when the timer ends wins the card. 🏆`,
      ].join("\n"),
      mentions: [sender],
    }, { quoted: msg });
  },
};
