/**
 * .bid <amount>
 * Place a bid on the active group auction.
 */
import {
  getAuction, placeBid, timeLeft, withAuctionLock, withBidderLock,
} from "../../lib/auctionManager.mjs";
import { formatCardLabel } from "../../lib/cardApi.mjs";
import {
  activeAuctionHoldAmount,
  AUCTION_HOLD_RECOVERY_GRACE_MS,
} from "../../lib/auctionHolds.mjs";
import {
  getUser       as getEconomyUser,
  isRegistered,
  setAuctionHold,
  clearAuctionHold,
} from "../economy/database.js";

export default {
  name:        "bid",
  aliases:     ["b"],
  category:    "cards",
  description: "Place a bid on the active group auction",
  usage:       ".bid <amount>",
  cooldown:    2,

  async run({ sock, msg, args, sender }) {
    const groupJid = msg.key.remoteJid;
    const reply    = (text) => sock.sendMessage(groupJid, { text }, { quoted: msg });

    // ── Groups only ────────────────────────────────────────────────────────
    if (!groupJid.endsWith("@g.us")) {
      return reply("Auctions only run in groups.");
    }

    return withBidderLock(sender, () => withAuctionLock(groupJid, async () => {
    // ── Active auction? ────────────────────────────────────────────────────
    const auction = getAuction(groupJid);
    if (!auction) {
      return reply("No active auction in this group right now.\n\nStart one with *.auction <index>*");
    }

    // ── Usage ──────────────────────────────────────────────────────────────
    if (!args[0]) {
      const secs = timeLeft(groupJid);
      return reply(
        `🔨 *ACTIVE AUCTION*\n\n` +
        `${formatCardLabel(auction.card)}\n` +
        `💰 Current bid : ${auction.currentBid > 0 ? `$${auction.currentBid.toLocaleString()}` : "No bids yet"}\n` +
        `💰 Minimum     : $${Math.max(auction.startBid, auction.currentBid + 1).toLocaleString()}\n` +
        `⏱️ Time left    : ${secs}s\n\n` +
        `Use *.bid <amount>* to place your bid!`
      );
    }

    // ── Economy registration ───────────────────────────────────────────────
    if (!await isRegistered(sender)) {
      return reply(" You need an economy account to bid.\n\nUse *.register <your name>* first.");
    }

    // ── Parse amount ───────────────────────────────────────────────────────
    const amount = parseInt(args[0].replace(/[^0-9]/g, ""));
    if (isNaN(amount) || amount <= 0) {
      return reply(" Enter a valid bid amount. Example: *.bid 1500*");
    }

    // ── Check wallet ───────────────────────────────────────────────────────
    const auctionId = auction.auctionId || `whatsapp:${groupJid}`;
    const user = await getEconomyUser(sender);
    const available = Math.max(0, (user.money || 0) - activeAuctionHoldAmount(user, Date.now(), auctionId));
    if (available < amount) {
      return reply(
        `❌ Not enough money!\n\n` +
        `💰 Available : $${available.toLocaleString()}\n` +
        `🎯 Your bid    : $${amount.toLocaleString()}`
      );
    }

    // ── Place bid ──────────────────────────────────────────────────────────
    const previousBid = auction.currentBid;
    const previousBidder = auction.currentBidder;
    const result = placeBid(groupJid, sender, amount);

    if (!result.ok) {
      if (result.reason === "own_auction") {
        return reply("You can't bid on your own auction, baka!");
      }
      if (result.reason === "too_low") {
        return reply(
          `❌ Bid too low!\n\n` +
          `💰 Current highest : $${result.current.toLocaleString()}\n` +
          `📌 You must bid more than the current highest bid.`
        );
      }
      if (result.reason === "below_start") {
        return reply(` Minimum starting bid is $${result.start.toLocaleString()}.`);
      }
      return reply("Could not place bid. The auction may have just ended.");
    }

    try {
      const holdUntil = auction.endsAt + AUCTION_HOLD_RECOVERY_GRACE_MS;
      if (!await setAuctionHold(sender, auctionId, amount, holdUntil)) {
        throw new Error("Bidder account could not be locked.");
      }
      if (previousBidder && previousBidder !== sender) {
        if (!await clearAuctionHold(previousBidder, auctionId)) {
          throw new Error("Previous bidder hold could not be released.");
        }
      }
    } catch (error) {
      auction.currentBid = previousBid;
      auction.currentBidder = previousBidder;
      await clearAuctionHold(sender, auctionId).catch(() => {});
      if (previousBidder) {
        await setAuctionHold(
          previousBidder,
          auctionId,
          previousBid,
          auction.endsAt + AUCTION_HOLD_RECOVERY_GRACE_MS,
        ).catch(() => {});
      }
      console.error("[auction] Could not persist bidder hold:", error);
      return reply("❌ I couldn't secure this bid in the shared wallet. Please try again.");
    }

    // ── Success ────────────────────────────────────────────────────────────
    const secs      = timeLeft(groupJid);
    const bidderNum = sender.split("@")[0].split(":")[0];

    return sock.sendMessage(groupJid, {
      text: [
        `💰 *NEW HIGHEST BID!*`,
        ``,
        `${formatCardLabel(auction.card)}`,
        ``,
        `🏆 Leader  : @${bidderNum}`,
        `💰 Bid     : $${amount.toLocaleString()}`,
        `🔒 Transfers pause while your bid leads.`,
        `⏱️ Time left: ${secs}s`,
        ``,
        `Beat it with *.bid <higher amount>*!`,
      ].join("\n"),
      mentions: [sender],
    }, { quoted: msg });
    }));
  },
};
