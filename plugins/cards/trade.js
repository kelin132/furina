/**
 * .trade <my card #> @user <their card #>  — propose a card trade
 * .trade accept                            — accept incoming trade offer
 * .trade deny                              — decline incoming trade offer
 * .trade cancel                            — cancel your outgoing offer
 * .trade info                              — see your pending offer
 *
 * Trades expire after 5 minutes.
 */
import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";

const EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

// pendingTrades[targetSender] = { from, fromCard, toCard, toCardIndex, fromCardIndex, chat, expiresAt }
const pendingTrades = {};

function resolveTarget(msg) {
  const ctx =
    msg.message?.extendedTextMessage?.contextInfo ||
    msg.message?.imageMessage?.contextInfo ||
    msg.message?.videoMessage?.contextInfo || {};
  return ctx?.mentionedJid?.[0] || ctx?.participant || null;
}

function cardLine(card) {
  return formatCardLabel(card);
}

// Clean up expired trades periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, trade] of Object.entries(pendingTrades)) {
    if (now > trade.expiresAt) delete pendingTrades[key];
  }
}, 60_000);

export default {
  name:     "trade",
  aliases:  ["cardtrade", "swapcards"],
  category: "cards",
  description: "Trade cards with another player",
  usage:    ".trade <your card #> @user <their card #>  |  .trade accept/deny/cancel/info",

  async run({ sock, msg, sender, args, text }) {
    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();

    const sub = (args[0] || "").toLowerCase();

    // ── INFO ─────────────────────────────────────────────────────────────────
    if (sub === "info") {
      // Check if sender has an outgoing trade
      const outgoing = Object.entries(pendingTrades).find(([, t]) => t.from === sender);
      if (outgoing) {
        const [target, trade] = outgoing;
        const left = Math.ceil((trade.expiresAt - now) / 1000);
        return reply(
`🔄 *YOUR PENDING TRADE OFFER*

📤 Your card   : ${cardLine(trade.fromCard)}
📥 Their card  : ${cardLine(trade.toCard)}
👤 To          : @${target.split("@")[0]}
⏳ Expires in  : ${left}s

They can type *.trade accept* or *.trade deny*.
You can cancel with *.trade cancel*.`
        );
      }

      // Check if sender has an incoming trade
      const incoming = pendingTrades[sender];
      if (incoming && incoming.expiresAt > now) {
        const left = Math.ceil((incoming.expiresAt - now) / 1000);
        return reply(
`🔄 *INCOMING TRADE OFFER*

📤 From        : @${incoming.from.split("@")[0]}
📤 Their card  : ${cardLine(incoming.fromCard)}
📥 They want   : ${cardLine(incoming.toCard)}
⏳ Expires in  : ${left}s

Type *.trade accept* or *.trade deny*.`
        );
      }

      return reply("❌ You have no pending trade offers.\n\nPropose one with *.trade <your card #> @user <their card #>*");
    }

    // ── CANCEL ───────────────────────────────────────────────────────────────
    if (sub === "cancel") {
      const outgoing = Object.entries(pendingTrades).find(([, t]) => t.from === sender);
      if (!outgoing) return reply("❌ You don't have an active outgoing trade offer.");
      const [target] = outgoing;
      delete pendingTrades[target];
      return reply(`✅ Trade offer to @${target.split("@")[0]} cancelled.`);
    }

    // ── DENY ─────────────────────────────────────────────────────────────────
    if (sub === "deny" || sub === "decline" || sub === "reject") {
      const trade = pendingTrades[sender];
      if (!trade || trade.expiresAt < now) {
        delete pendingTrades[sender];
        return reply("❌ You have no active incoming trade offer.");
      }
      const fromJid = trade.from;
      delete pendingTrades[sender];
      return sock.sendMessage(jid, {
        text:     `❌ *Trade Declined*\n\n@${sender.split("@")[0]} declined the trade offer from @${fromJid.split("@")[0]}.`,
        mentions: [sender, fromJid],
      }, { quoted: msg });
    }

    // ── ACCEPT ───────────────────────────────────────────────────────────────
    if (sub === "accept") {
      const trade = pendingTrades[sender];
      if (!trade || trade.expiresAt < now) {
        delete pendingTrades[sender];
        return reply("❌ You have no active incoming trade offer (or it expired).");
      }

      const accepterUser  = await findOrCreateUser(sender);
      const proposerUser  = await findOrCreateUser(trade.from);

      accepterUser.cards = Array.isArray(accepterUser.cards) ? accepterUser.cards : [];
      proposerUser.cards = Array.isArray(proposerUser.cards) ? proposerUser.cards : [];

      // Re-validate both cards are still present
      const accepterCard = accepterUser.cards.find(
        (c) => c.cardId === trade.toCard.cardId
      );
      const proposerCard = proposerUser.cards.find(
        (c) => c.cardId === trade.fromCard.cardId
      );

      if (!accepterCard) {
        delete pendingTrades[sender];
        return reply("❌ Trade failed — your card is no longer available (it may have been sold or gifted).");
      }
      if (!proposerCard) {
        delete pendingTrades[sender];
        return reply("❌ Trade failed — the other player's card is no longer available.");
      }

      // Check neither card is locked
      if (accepterCard.locked || accepterCard.inAuction) {
        delete pendingTrades[sender];
        return reply("❌ Trade failed — your card is locked or in auction.");
      }
      if (proposerCard.locked || proposerCard.inAuction) {
        delete pendingTrades[sender];
        return reply("❌ Trade failed — the other player's card is locked or in auction.");
      }

      // Swap cards
      const accepterIdx = accepterUser.cards.findIndex((c) => c.cardId === trade.toCard.cardId);
      const proposerIdx = proposerUser.cards.findIndex((c) => c.cardId === trade.fromCard.cardId);

      accepterUser.cards.splice(accepterIdx, 1, proposerCard);
      proposerUser.cards.splice(proposerIdx, 1, accepterCard);

      await accepterUser.save();
      await proposerUser.save();

      delete pendingTrades[sender];

      return sock.sendMessage(jid, {
        text:
`✅ *TRADE COMPLETE!*

@${trade.from.split("@")[0]} gave → ${cardLine(proposerCard)}
@${sender.split("@")[0]} gave   → ${cardLine(accepterCard)}

Both cards have been swapped! 🎉`,
        mentions: [trade.from, sender],
      }, { quoted: msg });
    }

    // ── PROPOSE TRADE ────────────────────────────────────────────────────────
    // Usage: .trade <my index> @user <their index>
    const target = resolveTarget(msg);
    if (!target) {
      return reply(
        "❌ Mention the user you want to trade with.\n\n" +
        "Usage: *.trade <your card #> @user <their card #>*\n" +
        "Example: .trade 3 @user 7"
      );
    }

    if (target === sender) return reply("❌ You can't trade with yourself.");

    // Pull numbers from args — skip arg that looks like a mention
    const nums = (text || "").match(/\d+/g)?.map(Number) || [];
    if (nums.length < 2) {
      return reply(
        "❌ Provide both card numbers.\n\n" +
        "Usage: *.trade <your card #> @user <their card #>*\n" +
        "Example: .trade 3 @user 7"
      );
    }

    const myIdx     = nums[0] - 1;
    const theirIdx  = nums[1] - 1;

    const senderUser = await findOrCreateUser(sender);
    const targetUser = await findOrCreateUser(target);

    senderUser.cards = Array.isArray(senderUser.cards) ? senderUser.cards : [];
    targetUser.cards = Array.isArray(targetUser.cards) ? targetUser.cards : [];

    if (senderUser.cards.length === 0) return reply("❌ You have no cards to trade.");
    if (targetUser.cards.length === 0) {
      return reply(`❌ @${target.split("@")[0]} has no cards to trade.`);
    }
    if (myIdx < 0 || myIdx >= senderUser.cards.length) {
      return reply(`❌ Invalid card number. You have ${senderUser.cards.length} cards. Use *.col* to check.`);
    }
    if (theirIdx < 0 || theirIdx >= targetUser.cards.length) {
      return reply(`❌ Invalid card number for @${target.split("@")[0]}. They have ${targetUser.cards.length} cards.`);
    }

    const myCard    = senderUser.cards[myIdx];
    const theirCard = targetUser.cards[theirIdx];

    if (myCard.locked || myCard.inAuction) return reply("❌ Your card is locked or in auction.");
    if (theirCard.locked || theirCard.inAuction) {
      return reply("❌ That card is locked or in auction and can't be traded.");
    }

    // Overwrite any previous outgoing offer from sender
    for (const [key, t] of Object.entries(pendingTrades)) {
      if (t.from === sender) delete pendingTrades[key];
    }

    pendingTrades[target] = {
      from:         sender,
      fromCard:     myCard,
      toCard:       theirCard,
      fromCardIndex: myIdx,
      toCardIndex:   theirIdx,
      chat:         jid,
      expiresAt:    now + EXPIRE_MS,
    };

    return sock.sendMessage(jid, {
      text:
`🔄 *TRADE OFFER SENT!*

📤 @${sender.split("@")[0]} offers : ${cardLine(myCard)}
📥 Wants from @${target.split("@")[0]}  : ${cardLine(theirCard)}

@${target.split("@")[0]}, type *.trade accept* to accept
or *.trade deny* to decline.
⏳ Offer expires in 5 minutes.`,
      mentions: [sender, target],
    }, { quoted: msg });
  },
};
