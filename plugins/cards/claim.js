import { findOrCreateUser, getUser as getCardUser } from "./db.js";
import { addHistory, addMoney, debitWalletIfAvailable } from "../economy/database.js";
import { formatCardLabel, sendCardMedia } from "../../lib/cardApi.mjs";
import { getCardClaimId as getClaimId, matchesCardClaimId as matchesClaimId } from "../../lib/cardClaimId.mjs";
import { ownsCardSpawnClaim, releaseCardSpawnClaim, reserveCardSpawnClaim } from "../../lib/cardSpawnClaim.mjs";
import { persistChargedCardClaim } from "../../lib/cardClaimPayment.mjs";

const activeSpawns = global.activeSpawns || (global.activeSpawns = {});

function toOwnedCard(card, spawnId) {
  return {
    cardId:     card.cardId,
    claimId:    getClaimId(card),
    name:       card.name,
    tier:       card.tier,
    tierNum:    card.tierNum || card.tier,
    index:      card.index || null,
    spawnId:    spawnId || card.spawnId || card.cardId,
    price:      card.price || 0,
    series:     card.series || "Unknown",
    media:      card.media || null,
    thumbnail:  card.thumbnail || card.thumbnailUrl || null,
    mediaType:  card.mediaType || ((card.tierNum === "6" || card.tierNum === "S") ? "gif" : "image"),
    obtainedAt: new Date(),
  };
}

function claimText(card, purchase = null) {
  if (purchase) {
    return `✅ ${formatCardLabel(card)} claimed for $${purchase.cost.toLocaleString()}.\n` +
      `👛 Wallet: $${purchase.wallet.toLocaleString()}. Use \`.col\` to view it.`;
  }
  return `✅ ${formatCardLabel(card)} claimed. Use \`.col\` to view it.`;
}

export default {
  name: "claim",
  aliases: ["collect"],
  category: "cards",
  description: "Claim a paid card or a spawned card",
  usage: ".claim [number]",

  async run({ sock, msg, args, sender }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    let reservedSpawn = null;
    let spawnReservation = null;

    try {
      const cardIdInput = (args[0] || "").toUpperCase();
      // Reserve a correctly matched public spawn synchronously, before the
      // user lookup can yield to MongoDB and let a later claimant overtake it.
      const initialSpawn = activeSpawns[jid];
      if (
        cardIdInput &&
        initialSpawn?.card &&
        matchesClaimId(
          { ...initialSpawn.card, cardId: initialSpawn.card.cardId || initialSpawn.cardId },
          cardIdInput,
        )
      ) {
        spawnReservation = reserveCardSpawnClaim(initialSpawn, sender);
        if (!spawnReservation) {
          return reply("⏳ Another user is already claiming this card. The first correct claim gets it.");
        }
        reservedSpawn = initialSpawn;
      }

      const user = await findOrCreateUser(sender);
      user.cards = Array.isArray(user.cards) ? user.cards : [];
      user.pendingCards = Array.isArray(user.pendingCards) ? user.pendingCards : [];

      // Personal pending cards were already paid for when they were created.
      const numericPending = cardIdInput
        ? user.pendingCards.find((card) => matchesClaimId(card, cardIdInput))
        : null;
      const legacyPending = cardIdInput
        ? user.pendingCards.find((card) => String(card.cardId || "").trim().toUpperCase() === cardIdInput)
        : null;
      const hasMatchingPending = cardIdInput
        ? Boolean(numericPending || legacyPending)
        : user.pendingCards.length > 0;
      if (hasMatchingPending) {
        releaseCardSpawnClaim(reservedSpawn, spawnReservation);
        reservedSpawn = null;
        spawnReservation = null;
        const selected = cardIdInput
          ? [numericPending || legacyPending].filter(Boolean)
          : user.pendingCards.slice();

        user.cards.push(...selected.map((card) => toOwnedCard(card, card.spawnId)));
        user.totalCards = (user.totalCards || 0) + selected.length;
        user.pendingCards = user.pendingCards.filter(
          (card) => !selected.includes(card),
        );
        await user.save();

        const first = selected[0];
        const text = selected.length === 1
          ? claimText(first)
          : `✅ ${selected.length} cards claimed. Use \`.col\` to view them.`;

        if (first?.media) {
          try {
            return await sendCardMedia(sock, jid, first, text, { quoted: msg, mentions: [sender] });
          } catch { /* fall through to text */ }
        }
        return sock.sendMessage(jid, { text, mentions: [sender] }, { quoted: msg });
      }

      // Preserve the existing chat-wide auto-spawn claim flow.
      if (!cardIdInput) return reply("❌ No pending card or card spawn.\n\nUse \`.claim <number>\` for a chat spawn.");
      const spawn = activeSpawns[jid];
      if (!spawn) return reply("❌ No active card spawn in this chat.");
      if (!matchesClaimId({ ...(spawn.card || {}), cardId: spawn.card?.cardId || spawn.cardId }, cardIdInput)) {
        return reply("❌ Wrong claim number! Try again.");
      }

      const card = spawn.card;
      if (!card) {
        delete activeSpawns[jid];
        return reply("❌ This card spawn is no longer available. Wait for the next spawn.");
      }
      if (
        spawn !== reservedSpawn ||
        !ownsCardSpawnClaim(spawn, spawnReservation)
      ) {
        return reply("⏳ This card is already being claimed. The first correct claim gets it.");
      }

      const cost = Number(card.price);
      if (!Number.isSafeInteger(cost) || cost <= 0) {
        return reply("❌ This card has no valid value and cannot be claimed.");
      }
      const ownedCard = toOwnedCard(card, spawn.spawnId);
      const payment = await persistChargedCardClaim({
        debit: () => debitWalletIfAvailable(sender, cost),
        saveCard: async () => {
          user.cards.push(ownedCard);
          user.totalCards = (user.totalCards || 0) + 1;
          await user.save();
        },
        hasCard: async () => {
          const latest = await getCardUser(sender);
          return latest?.cards?.some((owned) =>
            String(owned?.spawnId || "") === String(spawn.spawnId),
          ) === true;
        },
        refund: () => addMoney(sender, cost),
      });
      if (payment.status === "insufficient") {
        return reply(`❌ Not enough money. This card costs $${cost.toLocaleString()}.`);
      }
      if (payment.status !== "saved") {
        console.error("[claim] card payment could not be confirmed:", payment.error || payment.refundError);
        return reply(payment.status === "refunded"
          ? `❌ The card could not be saved. $${cost.toLocaleString()} was refunded.`
          : "⚠️ The claim could not be confirmed. Check your cards and wallet before retrying.");
      }
      await addHistory(sender, "card_claim", -cost, `Claimed ${card.name || "card"}`).catch(() => {});
      if (activeSpawns[jid] === spawn && ownsCardSpawnClaim(spawn, spawnReservation)) {
        delete activeSpawns[jid];
      }
      reservedSpawn = null;
      spawnReservation = null;

      const text = claimText(card, {
        cost,
        wallet: Number(payment.wallet?.money) || 0,
      });
      if (card.media) {
        try {
          return await sendCardMedia(sock, jid, card, text, { quoted: msg, mentions: [sender] });
        } catch { /* fall through to text */ }
      }
      return sock.sendMessage(jid, { text, mentions: [sender] }, { quoted: msg });
    } catch (err) {
      releaseCardSpawnClaim(reservedSpawn, spawnReservation);
      console.error("CLAIM ERROR:", err);
      return reply("❌ Claim failed. Please try again.");
    } finally {
      releaseCardSpawnClaim(reservedSpawn, spawnReservation);
    }
  },
};
