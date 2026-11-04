import { fetchAllCards, getCard, sendCardMedia, TIER_NAME, formatCardLabel } from "../../lib/cardApi.mjs";
import { Col } from "./db.js";
import { getSeries } from "../../lib/seriesEnrich.mjs";
import { getCachedLeaderboard } from "../../lib/leaderboardCache.mjs";
import { buildCardOwnersPipeline, collapseCardOwners, isMentionableOwner } from "../../lib/cardOwners.mjs";

function normaliseQuery(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? diagonal
        : Math.min(diagonal + 1, row[j] + 1, row[j - 1] + 1);
      diagonal = above;
    }
  }
  return row[b.length];
}

function findClosest(cards, query) {
  const needle = normaliseQuery(query);
  return cards
    .map((card) => {
      const name = normaliseQuery(card.name);
      const series = normaliseQuery(card.series);
      const score = name.includes(needle)
        ? 0
        : Math.min(distance(needle, name), distance(needle, series));
      return { card, score };
    })
    .sort((a, b) => a.score - b.score)[0];
}

/**
 * Parse the user input into a card-name query and an optional tier number.
 * "roronoa zoro 6"  → { nameQuery: "roronoa zoro", tier: "6" }
 * "roronoa zoro"    → { nameQuery: "roronoa zoro", tier: null }
 */
function parseInput(raw) {
  const tokens = raw.trim().split(/\s+/);
  const last = tokens[tokens.length - 1];

  const tierMap = {
    "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6", "s": "S",
    "c": "C", "r": "R", "sr": "SR", "ssr": "SSR", "ur": "UR", "x": "X",
    "t1": "1", "t2": "2", "t3": "3", "t4": "4", "t5": "5", "t6": "6", "ts": "S",
    "tc": "C", "tr": "R", "tsr": "SR", "tssr": "SSR", "tur": "UR", "tx": "X",
    "common": "1", "uncommon": "2", "rare": "3", "epic": "4",
    "legendary": "5", "mythical": "6", "secret": "S",
  };

  const tierKey = last.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (tierMap[tierKey]) {
    return { nameQuery: tokens.slice(0, -1).join(" "), tier: tierMap[tierKey] };
  }

  if (tokens.length >= 2) {
    const lastTwo = tokens.slice(-2).join(" ").toLowerCase();
    const tierFromTwo = tierMap[lastTwo.replace(/[^a-z0-9]/g, "")];
    if (tierFromTwo) {
      return { nameQuery: tokens.slice(0, -2).join(" "), tier: tierFromTwo };
    }
  }

  return { nameQuery: raw, tier: null };
}

/**
 * Find all cards matching a name query across all tiers.
 */
async function resolveWebsiteAuctionCards(query) {
  const needle = normaliseQuery(query);
  if (!needle || needle.length > 80) return [];
  try {
    const namePattern = needle.split("").join("[^a-z0-9]*");
    const cardSelector = {
      spawnId: { $regex: "^web-auction-" },
      $or: [
        { cardId: { $regex: namePattern, $options: "i" } },
        { name: { $regex: namePattern, $options: "i" } },
      ],
    };
    const users = await (await Col.users())
      .find({ cards: { $elemMatch: cardSelector } })
      .project({ cards: { $elemMatch: cardSelector } })
      .limit(100)
      .toArray();
    const matches = new Map();
    for (const user of users) {
      for (const card of Array.isArray(user.cards) ? user.cards : []) {
        if (!String(card.spawnId || "").startsWith("web-auction-")) continue;
        const cardId = normaliseQuery(card.cardId);
        const name = normaliseQuery(card.name);
        if (cardId === needle || name === needle || name.includes(needle)) {
          matches.set(String(card.cardId || `${name}:${card.tierNum || card.tier}`), card);
        }
      }
    }
    return [...matches.values()];
  } catch {
    return [];
  }
}

async function resolveCardsByName(query) {
  const websiteAuctionCards = await resolveWebsiteAuctionCards(query);
  if (websiteAuctionCards.length) return websiteAuctionCards;
  const all = await fetchAllCards();
  const needle = normaliseQuery(query);

  const exact = all.filter((c) => normaliseQuery(c.name) === needle);
  if (exact.length) return exact;

  const partial = all.filter((c) => normaliseQuery(c.name).includes(needle));
  if (partial.length) return partial;

  const closest = findClosest(all, query);
  if (closest && closest.score <= Math.max(2, Math.floor(needle.length * 0.4))) {
    return all.filter((c) => c.name === closest.card.name);
  }

  return [];
}

function auctionCardDetails(card) {
  if (!String(card.spawnId || "").startsWith("web-auction-")) return "";
  return `\n\n🆔 *Card ID:* \`${card.cardId || "—"}\`\n💰 *Auction paid:* \`${(Number(card.price) || 0).toLocaleString()} coins\``;
}

async function sendSeriesCard(sock, jid, card, text, { quoted, mentions = [] } = {}) {
  const caption = `${text}${auctionCardDetails(card)}`;
  if (card.media) return sendCardMedia(sock, jid, card, caption, { quoted, mentions });
  return sock.sendMessage(jid, { text: caption, mentions }, { quoted });
}

async function getOwners(card) {
  const cardId = String(card?.cardId || "").trim();
  return getCachedLeaderboard(
    `cards:owners:${cardId.toLowerCase()}`,
    async () => {
      const users = await (await Col.users())
        .aggregate(buildCardOwnersPipeline(card))
        .toArray();
      return collapseCardOwners(users);
    },
    // Owner lists must converge across both bots; never return an expired
    // snapshot while a background refresh runs.
    { ttlMs: 2_000, staleWhileRevalidate: false },
  );
}

function tierLabel(tierNum) {
  const name = TIER_NAME[tierNum] || "Unknown";
  return `T${tierNum} ${name}`;
}

export default {
  name: "si",
  aliases: ["seriesinfo"],
  category: "cards",
  description: "Show card owners and preview a series card (optionally by tier)",
  usage: ".si <card name> [tier]",

  async run({ sock, msg, args, sender }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const input = args.join(" ").trim();
      if (!input) return reply("❌ Usage: .si <card name> [tier]\n\nExample: .si roronoa zoro 6");

      const { nameQuery, tier } = parseInput(input);
      if (!nameQuery) return reply("❌ Usage: .si <card name> [tier]\n\nExample: .si roronoa zoro 6");

      const matches = await resolveCardsByName(nameQuery);
      if (matches.length === 0) {
        return reply(`❌ No card found matching "${nameQuery}".`);
      }

      const byTier = new Map();
      for (const card of matches) {
        const key = String(card.tierNum); // normalize to string so "6" === "6" always
        if (!byTier.has(key)) byTier.set(key, []);
        byTier.get(key).push(card);
      }

      const tierOrder = ["1", "2", "3", "4", "5", "6", "S", "C", "R", "SR", "SSR", "UR", "X"];
      const sortedTiers = [...byTier.keys()].sort(
        (a, b) => {
          const aIndex = tierOrder.indexOf(a);
          const bIndex = tierOrder.indexOf(b);
          return (aIndex < 0 ? tierOrder.length : aIndex) - (bIndex < 0 ? tierOrder.length : bIndex);
        }
      );

      // ── Tier specified: show that specific tier ────────────────────────────
      if (tier) {
        const tierCards = byTier.get(tier);
        if (!tierCards || tierCards.length === 0) {
          const available = sortedTiers.map((t) => `T${t}`).join(", ");
          return reply(
            `❌ No *${tierLabel(tier)}* version of "${matches[0].name}" found.\n\nAvailable tiers: ${available}`
          );
        }

        const card = tierCards[0];
        // Enrich series if still unknown (AniList, 4 s timeout)
        if (!card.series || card.series === "Unknown") {
          card.series = await getSeries(card.name, { timeout: 4000 });
        }

        const owners = await getOwners(card);
        const mentions = owners.map((o) => o.jid).filter(isMentionableOwner);

        const ownerLines = owners.length
          ? owners.map((owner, i) =>
              `${i + 1}. ${owner.label}${owner.count > 1 ? ` (x${owner.count})` : ""}`
            ).join("\n")
          : "  _No owners yet_";

        const text =
`╭━━━━━━━━━━━━━━━━━━━━╮\n│  📚 *Series Info*\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n🗂️ *${card.series || "Unknown"}*\n${formatCardLabel(card)}\n\n━━━━━━━━━━━━━━━━━━━━━\n👥 *Owners (${owners.length})*\n━━━━━━━━━━━━━━━━━━━━━\n${ownerLines}\n\n━━━━━━━━━━━━━━━━━━━━━\n💡 _Other tiers: .si ${card.name} <tier>_\nAvailable: ${sortedTiers.map((t) => `T${t}`).join(", ")}`;

        return sendSeriesCard(sock, jid, card, text, { quoted: msg, mentions });
      }

      // ── No tier specified ───────────────────────────────────────────────────
      if (sortedTiers.length === 1) {
        const card = byTier.get(sortedTiers[0])[0];
        // Enrich series if still unknown
        if (!card.series || card.series === "Unknown") {
          card.series = await getSeries(card.name, { timeout: 4000 });
        }
        const owners = await getOwners(card);
        const mentions = owners.map((o) => o.jid).filter(isMentionableOwner);

        const ownerLines = owners.length
          ? owners.map((owner, i) =>
              `${i + 1}. ${owner.label}${owner.count > 1 ? ` (x${owner.count})` : ""}`
            ).join("\n")
          : "  _No owners yet_";

        const text =
`╭━━━━━━━━━━━━━━━━━━━━╮\n│  📚 *Series Info*\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n🗂️ *${card.series || "Unknown"}*\n${formatCardLabel(card)}\n\n━━━━━━━━━━━━━━━━━━━━━\n👥 *Owners (${owners.length})*\n━━━━━━━━━━━━━━━━━━━━━\n${ownerLines}`;

        return sendSeriesCard(sock, jid, card, text, { quoted: msg, mentions });
      }

      // Multiple tiers — show a summary of all tiers with owner counts
      const tierSummaries = [];
      let totalOwners = 0;
      let mentions = [];

      // Enrich series on the representative card (same character, so one lookup suffices)
      const repCard = byTier.get(sortedTiers[0])[0];
      if (!repCard.series || repCard.series === "Unknown") {
        repCard.series = await getSeries(repCard.name, { timeout: 4000 });
        // Propagate to all tiers since it's the same character
        for (const t of sortedTiers) { byTier.get(t)[0].series = repCard.series; }
      }

      for (const t of sortedTiers) {
        const card = byTier.get(t)[0];
        const owners = await getOwners(card);
        totalOwners += owners.length;
        mentions.push(...owners.map((o) => o.jid).filter(isMentionableOwner));

        const ownerPreview = owners.length
          ? owners.slice(0, 5).map((o, i) => `   ${i + 1}. ${o.label}${o.count > 1 ? ` (x${o.count})` : ""}`).join("\n") +
            (owners.length > 5 ? `\n   _...and ${owners.length - 5} more_` : "")
          : "   _No owners yet_";

        tierSummaries.push(
`┃  ${tierLabel(t)} — ${owners.length} owner${owners.length !== 1 ? "s" : ""}\n${ownerPreview}\n┃  💡 _.si ${card.name} ${t}_ for details`
        );
      }

      const text =
`╭━━━━━━━━━━━━━━━━━━━━╮\n│  📚 *Series Info*\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n🗂️ *${repCard.series || matches[0].series || "Unknown"}*\n🃏 ${matches[0].name}\n\n━━━━━━━━━━━━━━━━━━━━━\n📊 *All Tiers — ${totalOwners} total owners*\n━━━━━━━━━━━━━━━━━━━━━\n${tierSummaries.join("\n┃\n")}\n\n━━━━━━━━━━━━━━━━━━━━━\n💡 _.si <name> <tier>_ for a specific tier`;

      const previewCard = byTier.get(sortedTiers[0])[0];
      return sendSeriesCard(sock, jid, previewCard, text, { quoted: msg, mentions });

    } catch (err) {
      console.error("SI ERROR:", err);
      return reply("❌ Failed to load series card info.");
    }
  },
};
