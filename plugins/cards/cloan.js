/**
 * .cloan <card_index> <amount>  — take a loan using a card as collateral
 * .cloan pay                    — repay your card loan and get the card back
 * .cloan info                   — check card loan status
 *
 * Card is held in escrow until the loan is repaid.
 * Max loan per tier:
 *   Common $500 | Uncommon $1,000 | Rare $3,000 | Epic $7,000 | Legendary $15,000
 * Interest: 5%/day — due in 7 days. Overdue = card is forfeited.
 */
import { findOrCreateUser }                from "./db.js";
import { formatCardLabel }                 from "../../lib/cardApi.mjs";
import { getUser, saveUser, addHistory,
         requireRegistration }             from "../economy/database.js";

const INTEREST_PCT = 0.05;
const DUE_DAYS     = 7;

const TIER_LIMITS = {
  Common:    500,
  Uncommon:  1_000,
  Rare:      3_000,
  Epic:      7_000,
  Legendary: 15_000,
};

export default {
  name:     "cloan",
  aliases:  ["cardloan", "clborrow"],
  category: "cards",
  description: "Borrow money using a card as collateral",
  usage:    ".cloan <card index> <amount>  |  .cloan pay  |  .cloan info",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();

    const cardUser = await findOrCreateUser(sender);
    const ecoUser  = await getUser(sender);

    const sub = (args[0] || "info").toLowerCase();

    // ── INFO ─────────────────────────────────────────────────────────────────
    if (sub === "info") {
      const loan = cardUser.cardLoan;
      if (!loan?.active) {
        return reply(
          "🃏 You have no active card loan.\n\n" +
          "Use *.cloan <card number> <amount>* to borrow against a card.\n\n" +
          "*Max loan by rarity:*\n" +
          "Common → $500\nUncommon → $1,000\nRare → $3,000\nEpic → $7,000\nLegendary → $15,000"
        );
      }

      const daysLeft = Math.max(0, Math.ceil((loan.due - now) / 86_400_000));
      const daysUsed = Math.max(1, Math.ceil((now - loan.issuedAt) / 86_400_000));
      const interest = Math.round(loan.amount * INTEREST_PCT * daysUsed);
      const overdue  = now > loan.due;

      return reply(
`🃏 *CARD LOAN INFO*

Collateral : ${formatCardLabel(loan.card)}
💸 Borrowed   : $${loan.amount.toLocaleString()}
💹 Interest   : 5%/day
📅 Due        : ${new Date(loan.due).toDateString()}
${overdue
  ? "⚠️ *OVERDUE! Repay now or your card is forfeited!*"
  : `⏳ Due in    : ${daysLeft} day(s)`}

💳 Repay now  : $${(loan.amount + interest).toLocaleString()}
Use *.cloan pay* to repay and reclaim your card.`
      );
    }

    // ── PAY ──────────────────────────────────────────────────────────────────
    if (sub === "pay") {
      const loan = cardUser.cardLoan;
      if (!loan?.active) return reply("❌ You don't have an active card loan.");

      const daysUsed = Math.max(1, Math.ceil((now - loan.issuedAt) / 86_400_000));
      const interest = Math.round(loan.amount * INTEREST_PCT * daysUsed);
      const total    = loan.amount + interest;

      if (ecoUser.money < total) {
        return reply(
`❌ *Not enough cash!*

💸 Loan + interest : $${total.toLocaleString()}
💰 Your wallet     : $${ecoUser.money.toLocaleString()}
📉 Short by        : $${(total - ecoUser.money).toLocaleString()}

Earn more with *.daily*, *.work*, *.fish*, *.dig*.`
        );
      }

      // Deduct money, restore card
      ecoUser.money -= total;
      await saveUser(sender, ecoUser);
      await addHistory(sender, "withdraw", -total, `Repaid card loan ($${loan.amount} + $${interest} interest)`);

      if (!Array.isArray(cardUser.cards)) cardUser.cards = [];
      cardUser.cards.push(loan.card);
      cardUser.totalCards = (cardUser.totalCards || 0) + 1;
      cardUser.cardLoan   = null;
      await cardUser.save();

      return reply(
`✅ *Card Loan Repaid!*

💸 Repaid    : $${total.toLocaleString()}
  (principal $${loan.amount.toLocaleString()} + $${interest.toLocaleString()} interest)
Returned  : ${formatCardLabel(loan.card)}
💰 Balance   : $${ecoUser.money.toLocaleString()}

Your card is back in your collection! 🎉`
      );
    }

    // ── TAKE LOAN ─────────────────────────────────────────────────────────────
    if (cardUser.cardLoan?.active) {
      return reply("❌ You already have an active card loan.\n\nUse *.cloan pay* to repay it first.");
    }

    const index  = parseInt(args[0], 10) - 1;
    const amount = parseInt(args[1], 10);

    if (isNaN(index) || index < 0) {
      return reply("❌ Usage: *.cloan <card number> <amount>*\nExample: .cloan 3 1000\n\nUse *.col* to see your card numbers.");
    }
    if (isNaN(amount) || amount <= 0) {
      return reply("❌ Please provide a valid amount.\nExample: .cloan 3 1000");
    }

    if (!Array.isArray(cardUser.cards) || cardUser.cards.length === 0) {
      return reply("❌ You have no cards to use as collateral.");
    }
    if (index >= cardUser.cards.length) {
      return reply(`❌ Invalid card number. You have ${cardUser.cards.length} cards. Use *.col* to check.`);
    }

    const card = cardUser.cards[index];
    if (!card) return reply("❌ Card not found.");
    if (card.locked || card.inAuction) {
      return reply("❌ This card is already locked or in an auction and can't be used as collateral.");
    }

    const maxLoan = TIER_LIMITS[card.tier] || 500;
    if (amount > maxLoan) {
      return reply(
`❌ *Loan too high!*

${formatCardLabel(card)}
💰 Max loan for this tier: $${maxLoan.toLocaleString()}
💡 You requested: $${amount.toLocaleString()}`
      );
    }
    if (amount < 100) return reply("❌ Minimum loan amount is $100.");

    // Remove card from inventory, store as collateral
    cardUser.cards.splice(index, 1);
    cardUser.totalCards = Math.max(0, (cardUser.totalCards || 1) - 1);
    cardUser.cardLoan   = {
      active:   true,
      amount,
      issuedAt: now,
      due:      now + DUE_DAYS * 86_400_000,
      interest: INTEREST_PCT,
      card,
    };
    await cardUser.save();

    // Add money to economy wallet
    ecoUser.money += amount;
    await saveUser(sender, ecoUser);
    await addHistory(sender, "transfer_in", amount, `Card loan: ${card.name} as collateral`);

    return reply(
`🃏 *CARD LOAN APPROVED!*

Collateral : ${formatCardLabel(card)}
💰 Received   : $${amount.toLocaleString()}
📅 Due Date   : ${new Date(cardUser.cardLoan.due).toDateString()}
💹 Interest   : 5% per day

⚠️ Your card is held until you repay.
Use *.cloan pay* to reclaim it.
💰 New Balance: $${ecoUser.money.toLocaleString()}`
    );
  },
};
