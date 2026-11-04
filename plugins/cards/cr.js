import { findOrCreateUser, fmt, tag } from "./db.js";
import { getUser, saveUser } from "../economy/database.js";
import { hasActiveBidder, withBidderLock } from "../../lib/auctionManager.mjs";
import { hasActiveAuctionHolds } from "../../lib/auctionHolds.mjs";
import { formatCardLabel } from "../../lib/cardApi.mjs";

// In-memory trade requests — keyed by jid+target so each chat is isolated
const tradeRequests = new Map();

export default {
  name: "cr",
  aliases: ["cardsell", "sellto"],
  category: "cards",
  description: "Sell a card directly to another user  |  .cr accept to buy",
  usage: ".cr <price> <index> @user  |  .cr accept",

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const sub = (args[0] || "").toLowerCase();

      // ── ACCEPT ──────────────────────────────────────────────────────────────
      if (sub === "accept") {
        const req = tradeRequests.get(jid + sender);
        if (!req) return reply("❌ You don't have any pending card purchase requests.");

        return withBidderLock(sender, async () => {
        // Economy money lives in the economy DB (money field), NOT the card system balance
        const econBuyer  = await getUser(req.buyer);
        const econSeller = await getUser(req.seller);
        if (hasActiveBidder(sender) || hasActiveAuctionHolds(econBuyer)) {
          return reply("❌ You can't transfer money for a card purchase while you hold the highest auction bid. Try again if you're outbid or after the auction ends.");
        }

        const buyerMoney = (econBuyer?.money || 0) + (econBuyer?.bank || 0);
        if (buyerMoney < req.price) {
          tradeRequests.delete(jid + sender);
          return reply(
            `❌ You don't have enough money to buy this card.\n\n` +
            `💰 You have: *$${fmt(econBuyer?.money || 0)}* (wallet) + *$${fmt(econBuyer?.bank || 0)}* (bank)\n` +
            `🏷️ Price: *$${fmt(req.price)}*`
          );
        }

        // Deduct from buyer — take from wallet first, then bank if needed
        let remaining = req.price;
        const walletDeduct = Math.min(econBuyer.money || 0, remaining);
        econBuyer.money = (econBuyer.money || 0) - walletDeduct;
        remaining -= walletDeduct;
        if (remaining > 0) {
          econBuyer.bank = (econBuyer.bank || 0) - remaining;
        }

        // Credit seller's wallet
        econSeller.money = (econSeller.money || 0) + req.price;

        // Verify seller still has the card (by cardId + index)
        const seller = await findOrCreateUser(req.seller);
        const buyer  = await findOrCreateUser(req.buyer);

        const cardIdx = seller.cards.findIndex((c, i) => i === req.cardIndex && c.cardId === req.cardId);
        if (cardIdx === -1) {
          tradeRequests.delete(jid + sender);
          return reply("❌ The seller no longer has this card.");
        }

        const card = seller.cards[cardIdx];
        seller.cards.splice(cardIdx, 1);
        buyer.cards.push(card);

        // Save card collections and economy balances
        await seller.save();
        await buyer.save();
        await saveUser(req.buyer,  econBuyer);
        await saveUser(req.seller, econSeller);
        tradeRequests.delete(jid + sender);

        return await sock.sendMessage(jid, {
          text:
`🤝 *CARD TRADE COMPLETE*

🃏 Card: *${card.name}*
💰 Price: *$${fmt(req.price)}*

📤 Seller: ${tag(req.seller)}
📥 Buyer: ${tag(req.buyer)}`,
          mentions: [req.seller, req.buyer],
        }, { quoted: msg });
        });
      }

      // ── CREATE REQUEST ───────────────────────────────────────────────────────
      const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0]
                  || msg.message?.extendedTextMessage?.contextInfo?.participant;

      if (!target) {
        return reply("❌ Mention or reply to a user to sell them a card.\nUsage: .cr <price> <index> @user");
      }

      if (target === sender) return reply("❌ You can't sell a card to yourself.");

      const price = parseInt(args[0]);
      const index = parseInt(args[1]) - 1;

      if (isNaN(price) || price <= 0 || isNaN(index) || index < 0) {
        return reply("❌ Usage: .cr <price> <index> @user");
      }

      const sellerUser = await findOrCreateUser(sender);
      if (!sellerUser.cards || index >= sellerUser.cards.length) {
        return reply("❌ Invalid card index. Use .col to see your cards.");
      }

      const card = sellerUser.cards[index];
      if (card.locked || card.inAuction) return reply("❌ This card is locked or in auction.");

      tradeRequests.set(jid + target, {
        seller:    sender,
        buyer:     target,
        cardId:    card.cardId,
        cardIndex: index,
        price,
        time: Date.now(),
      });

      setTimeout(() => tradeRequests.delete(jid + target), 60_000);

      return await sock.sendMessage(jid, {
        text:
`$${tag(target)}, ${tag(sender)} wants to sell you their card:

Card: ${formatCardLabel(card)}
💰 Price: *$${fmt(price)}*

> Type *.cr accept* to buy this card.
> _Expires in 60 seconds._`,
        mentions: [sender, target],
      }, { quoted: msg });

    } catch (err) {
      console.error("CR CMD ERROR:", err);
      return reply("❌ Error processing card sale request.");
    }
  },
};
