import { getCardClaimId } from "../../lib/cardClaimId.mjs";
/**
 * KELIN MD — .summon
 * Summon a random card from any tier (or a specific tier).
 * Costs coins from the user's card balance based on the tier summoned.
 * The result is held as a pending claim until the user runs .claim.
 *
 * Usage:
 *   .summon           — random tier summon; claim it later with .claim
 *   .summon <tier>    — specific tier (1-6, S, C, R, SR, SSR, UR, X, or a tier name)
 */
import { findOrCreateUser, getUser as getCardUser } from "./db.js";
import { getUser, debitWalletIfAvailable, addMoney, requireRegistration, addHistory } from "../economy/database.js";
import { persistChargedSummon } from "../../lib/summonPersistence.mjs";
import {
  fetchCardByTier,
  sendCardMedia,
  formatCardLabel,
  createSpawnId,
  resolveSummonTier,
} from "../../lib/cardApi.mjs";
import { getSeries } from "../../lib/seriesEnrich.mjs";

// ── Summon costs by tier ──────────────────────────────────────────────────────
export const SUMMON_COST = {
  Common:    10000,
  Uncommon:  50000,
  Rare:      100000,
  Epic:      150000,
  Legendary: 200000,
  Mythical:  750000,
  Secret:    1500000, // Fixed: Secret tier cost
  C:         3000000,
  R:         4000000,
  SR:        8000000,
  SSR:       15000000,
  UR:        30000000,
  X:         60000000,
};

// ── Weighted random tier (bias towards lower tiers) ───────────────────────────
const RANDOM_TIER_WEIGHTS = [
  { tier: "Common",    weight: 40 },
  { tier: "Uncommon",  weight: 25 },
  { tier: "Rare",      weight: 18 },
  { tier: "Epic",      weight: 10 },
  { tier: "Legendary", weight:  5 },
  { tier: "Mythical",  weight:  2 },
  { tier: "Secret",    weight:  0.7 },
  { tier: "C",         weight:  0.25 },
  { tier: "R",         weight:  0.1 },
  { tier: "SR",        weight:  0.05 },
  { tier: "SSR",       weight:  0.02 },
  { tier: "UR",        weight:  0.01 },
  { tier: "X",         weight:  0.005 },
];
const TOTAL_WEIGHT = RANDOM_TIER_WEIGHTS.reduce((s, t) => s + t.weight, 0);
const SUMMON_COOLDOWN_MS = 20_000;
const summonCooldowns = new Map();

function rollRandomTier() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const t of RANDOM_TIER_WEIGHTS) {
    r -= t.weight;
    if (r <= 0) return t.tier;
  }
  return "Common";
}

export default {
  name: "summon",
  aliases: ["nsummon", "cardsummon", "pull"],
  category: "cards",
  description: "Summon a card to claim later — costs coins based on tier",
  usage: ".summon [tier]  — e.g. .summon  |  .summon rare  |  .summon 5  |  .summon mythical  |  .summon secret",
  cooldown: 30,

  async run({ sock, msg, args, sender }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      // Help
      if ((args[0] || "").toLowerCase() === "help") {
        return reply(
`╭━━━〔 🔮 𝑺𝑼𝑴𝑴𝑶𝑵 𝑺𝒀𝑺𝑻𝑬𝑴 ✨ 〕━━━╮
┃ ✦ Summon a card, then use \`.claim\` to collect it!
┃ ✦ Costs coins per tier from your wallet.
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━
┃ 💰 𝗦𝘂𝗺𝗺𝗼𝗻 𝗖𝗼𝘀𝘁𝘀
┃
┃ T1 Common     › \`$${SUMMON_COST.Common.toLocaleString()}\`
┃ T2 Uncommon   › \`$${SUMMON_COST.Uncommon.toLocaleString()}\`
┃ T3 Rare       › \`$${SUMMON_COST.Rare.toLocaleString()}\`
┃ T4 Epic       › \`$${SUMMON_COST.Epic.toLocaleString()}\`
┃ T5 Legendary  › \`$${SUMMON_COST.Legendary.toLocaleString()}\`
┃ T6 Mythical   › \`$${SUMMON_COST.Mythical.toLocaleString()}\`
┃ TS Secret     › \`$${SUMMON_COST.Secret.toLocaleString()}\`
┃ C              › \`$${SUMMON_COST.C.toLocaleString()}\`
┃ R              › \`$${SUMMON_COST.R.toLocaleString()}\`
┃ SR             › \`$${SUMMON_COST.SR.toLocaleString()}\`
┃ SSR            › \`$${SUMMON_COST.SSR.toLocaleString()}\`
┃ UR             › \`$${SUMMON_COST.UR.toLocaleString()}\`
┃ X              › \`$${SUMMON_COST.X.toLocaleString()}\`
┃
┣━━━━━━━━━━━━━━━━━━━━━━━━
┃ 📖 𝗨𝘀𝗮𝗴𝗲
┃
┃ \`.summon\`          — random tier
┃ \`.summon 1\`        — Common (T1)
┃ \`.summon 2\`        — Uncommon (T2)
┃ \`.summon 3\`        — Rare (T3)
┃ \`.summon 4\`        — Epic (T4)
┃ \`.summon 5\`        — Legendary (T5)
┃ \`.summon 6\`        — Mythical (T6)
┃ \`.summon secret\`   — Secret (Tier S)
┃ \`.summon C/R/SR\`   — random higher tier
┃ \`.summon SSR/UR/X\` — random top tier
┃
┃ 💡 Earn coins via \`.daily\` \`.work\` \`.crime\`
╰━━━━━━━━━━━━━━━━━━━━━━━━╯`
        );
      }

      const now = Date.now();
      const lastSummon = summonCooldowns.get(sender);
      if (lastSummon) {
        const elapsed = now - lastSummon;
        if (elapsed < SUMMON_COOLDOWN_MS) {
          const remaining = Math.ceil((SUMMON_COOLDOWN_MS - elapsed) / 1000);
          return reply(
`╭━━━〔 ⏳ 𝑪𝑶𝑶𝑳𝑫𝑶𝑾𝑵 〕━━━╮
┃ ✦ Summon is on cooldown!
┃
┃ ⏱ Wait › 『 \`${remaining}s\` 』
┃
┃ The cards need time to rest...
╰━━━━━━━━━━━━━━━━━━━━╯`
          );
        }
        summonCooldowns.delete(sender);
      }

      // Resolve tier
      let tierName;
      let isRandom = false;
      if (!args[0]) {
        isRandom = true;
        tierName = rollRandomTier();
      } else {
        tierName = resolveSummonTier(args[0]);
        if (!tierName) {
          return reply(
`unknown tier, check the tier list again`
          );
        }
      }

      // Start the cooldown only for a valid summon attempt.
      summonCooldowns.set(sender, now);

      // Strict cost lookup
      const cost = SUMMON_COST[tierName] ?? SUMMON_COST.Common;

      // ── Require economy registration ────────────────────────────────────────
      if (!await requireRegistration(sock, msg, sender)) return;

      // ── Check economy wallet ────────────────────────────────────────────────
      const ecoUser = await getUser(sender);

      if ((ecoUser.money || 0) < cost) {
        return reply(
`you don't have enough money to summon a card! `
        );
      }

      // ── Fetch a card from the resolved tier ─────────────────────────────────
      const card = await fetchCardByTier(tierName);
      if (!card) {
        return reply(
`No cards found for this tier`
        );
      }

      // Enrich series from AniList
      if (!card.series || card.series === "Unknown") {
        card.series = await getSeries(card.name, { timeout: 4000 });
      }

      // ── Hold the card until the user explicitly claims it ────────────────────
      const cardUser = await findOrCreateUser(sender);
      cardUser.pendingCards = Array.isArray(cardUser.pendingCards)
        ? cardUser.pendingCards
        : [];

      const pendingCard = {
        cardId:     card.cardId,
        claimId:    getCardClaimId(card),
        name:       card.name,
        tier:       card.tier,
        tierNum:    card.tierNum || card.tier,
        index:      card.index || null,
        spawnId:    createSpawnId(),
        price:      card.price  || 0,
        series:     card.series || "Unknown",
        media:      card.media  || null,
        mediaFallbacks: Array.isArray(card.mediaFallbacks) ? card.mediaFallbacks : [],
        thumbnail: card.thumbnail || card.thumbnailUrl || null,
        mediaType:  card.mediaType || ((card.tierNum === "6" || card.tierNum === "S" || card.tier === "Secret") ? "gif" : "image"),
        summonedAt: new Date(),
      };

      const payment = await persistChargedSummon({
        debit: () => debitWalletIfAvailable(sender, cost),
        savePending: async () => {
          cardUser.pendingCards.push(pendingCard);
          await cardUser.save();
        },
        hasPending: async () => {
          const latest = await getCardUser(sender);
          return latest?.pendingCards?.some((entry) => entry?.spawnId === pendingCard.spawnId) === true;
        },
        refund: () => addMoney(sender, cost),
      });
      if (payment.status === "insufficient") {
        return reply(`you don't have enough money to summon a card!`);
      }
      if (payment.status !== "saved") {
        console.error("[summon] pending-card write failed after debit:", payment.error);
        return reply(payment.status === "refunded"
          ? "❌ The card could not be saved. Your coins were refunded."
          : "⚠️ The summon could not be confirmed. Check .claim before trying again; your wallet was not changed again.");
      }
      ecoUser.money = payment.wallet.money;
      await addHistory(sender, "summon", -cost, `Summoned ${tierName} card`).catch(() => {});

      const claimText =
`╭━━━〔 🃏 𝑺𝑼𝑴𝑴𝑶𝑵 𝑺𝒀𝑺𝑻𝑬𝑴 ✨ 〕━━━╮
┃ ✦ A card has appeared from the ether...
┃${isRandom ? `\n┃ 🎲 Roll  ➜ 『 \`${tierName} Tier\` 』` : ""}
┃ ${formatCardLabel(card)}
┃ 📺 Series ➜ 『 \`${card.series}\` 』
┃ 🔢 Claim # ➜ 『 \`${pendingCard.claimId}\` 』
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 💸 Cost   › \`$${cost.toLocaleString()}\`
┃ 👛 Wallet › \`$${ecoUser.money.toLocaleString()}\`
┣━━━━━━━━━━━━━━━━━━━━
┃ ✨ 𝗖𝗟𝗔𝗜𝗠 𝗥𝗘𝗔𝗗𝗬!
┃ The card is waiting for you.
┃ Use \`.claim ${pendingCard.claimId}\` to add this card.
╰━━━━━━━━━━━━━━━━━━━━╯`;

      if (card.media) {
        try {
          return await sendCardMedia(
            sock,
            jid,
            card,
            claimText,
            { quoted: msg, mentions: [sender] },
          );
        } catch { /* fall through to text */ }
      }

      return sock.sendMessage(jid, {
        text:     claimText,
        mentions: [sender],
      }, { quoted: msg });

    } catch (err) {
      console.error("SUMMON ERROR:", err);

      if (err.code === "CARD_API_DOWN") {
        return reply(
`card Api is down, please be patient while our team gets working on the problem`
        );
      }

      return reply(
`card failed to be summoned`
      );
    }
  },
};
