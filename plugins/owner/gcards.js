import { createSpawnId, fetchAllCards, TIER_NAME, TIER_NUM, formatCardLabel } from "../../lib/cardApi.mjs";
import { findOrCreateUser, uid } from "../cards/db.js";

const MAX_BULK_CARDS = 100;

function contextInfo(msg) {
  return msg.message?.extendedTextMessage?.contextInfo
    || msg.message?.imageMessage?.contextInfo
    || msg.message?.videoMessage?.contextInfo
    || msg.message?.documentMessage?.contextInfo
    || {};
}

function resolveTarget(msg) {
  const context = contextInfo(msg);
  const mentioned = Array.isArray(context.mentionedJid) ? context.mentionedJid : [];
  return mentioned[0] || context.participant || null;
}

function normalizeTier(value) {
  if (!value) return null;
  const key = String(value).trim().toLowerCase();
  return TIER_NUM[key] || TIER_NUM[key.replace(/^tier\s*/i, "")] || null;
}

function ownedCard(card) {
  return {
    cardId: card.cardId,
    name: card.name,
    tier: card.tier,
    tierNum: card.tierNum || card.tier,
    index: card.index || null,
    spawnId: `gcard-${Date.now().toString(36)}-${createSpawnId()}`,
    price: card.price || 0,
    series: card.series || "Unknown",
    media: card.media || null,
    mediaType: card.mediaType || ((card.tierNum === "6" || card.tierNum === "S") ? "gif" : "image"),
    obtainedAt: new Date(),
  };
}

function parseTierQualifiedQuery(input) {
  const value = String(input || "").trim();
  const match = value.match(/^(.*?)(?:\s*(?:\||#|\btier\s*)\s*(common|uncommon|rare|epic|legendary|mythical|secret|ssr|sr|ur|[1-6screx]))$/i);
  if (!match) return { query: value, tierNum: null };
  return { query: match[1].trim(), tierNum: normalizeTier(match[2]) };
}

function splitCardQueries(input) {
  return String(input || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function seriesRequest(input) {
  const match = String(input || "").match(/^series(?:\s*[:=]\s*|\s+)(.+)$/i);
  return match ? match[1].trim() : null;
}

function cardLabel(card) {
  return `${formatCardLabel(card)} · ${card.cardId}`;
}

function resolveCard(allCards, input) {
  const { query, tierNum } = parseTierQualifiedQuery(input);
  const lower = query.toLowerCase();
  let matches = allCards.filter((card) => String(card.cardId).toLowerCase() === lower);
  if (!matches.length) {
    matches = allCards.filter((card) => String(card.name).toLowerCase() === lower);
  }
  if (!matches.length) {
    matches = allCards.filter((card) => String(card.name).toLowerCase().includes(lower));
  }
  if (tierNum) matches = matches.filter((card) => card.tierNum === tierNum);
  return { query, matches };
}

function formatUsage() {
  return `❌ Usage:

• *.gcards <card id or name> @user*
• *.gcards <card1,card2,card3> @user*
• *.gcards <card name> | <tier> @user*
• *.gcards series <series name> @user*

You can also reply to the user’s message instead of mentioning them.
Tiers: 1–6, S, C, R, SR, SSR, UR, or X.`;
}

export default {
  name: "gcards",
  aliases: ["givecard", "givecards"],
  category: "owner",
  description: "Give one, multiple, or a complete series of cards (owner/level 3)",
  usage: ".gcards <card|card1,card2|series name> @user",
  cooldown: 3,

  async run({ sock, msg, args, isOwner, staffLevel }) {
    const jid = msg.key.remoteJid;
    const reply = (text, extra = {}) => sock.sendMessage(jid, { text, ...extra }, { quoted: msg });

    if (!isOwner && Number(staffLevel || 0) < 3) {
      return reply("❌ This command is restricted to the bot owner and level 3 administrators.");
    }

    const targetJid = resolveTarget(msg);
    if (!targetJid) return reply(`❌ Mention the recipient or reply to their message.\n\n${formatUsage()}`);

    const input = args.join(" ").replace(/@[\d+]+/g, "").trim();
    if (!input) return reply(formatUsage());

    try {
      const allCards = await fetchAllCards();
      let grantedCards = [];
      let mode = "card";
      let missing = [];
      let ambiguous = [];

      const requestedSeries = seriesRequest(input);
      if (requestedSeries) {
        mode = "series";
        const seriesQuery = requestedSeries.toLowerCase();
        const exactSeries = [...new Set(allCards.map((card) => card.series).filter(Boolean))]
          .find((series) => String(series).toLowerCase() === seriesQuery);
        const seriesMatches = allCards.filter((card) => {
          const series = String(card.series || "").toLowerCase();
          return exactSeries
            ? series === String(exactSeries).toLowerCase()
            : series.includes(seriesQuery);
        });
        if (!seriesMatches.length) return reply(`❌ No card series matched *${requestedSeries}*.`);
        if (!exactSeries) {
          const seriesNames = [...new Set(seriesMatches.map((card) => card.series))];
          if (seriesNames.length > 1) {
            return reply(`❌ That series search is ambiguous. Try one of these:\n\n${seriesNames.slice(0, 12).map((name) => `• ${name}`).join("\n")}`);
          }
        }
        grantedCards = seriesMatches;
      } else {
        const queries = splitCardQueries(input);
        if (!queries.length) return reply(formatUsage());
        if (queries.length > MAX_BULK_CARDS) {
          return reply(`❌ You can grant up to ${MAX_BULK_CARDS} cards in one command.`);
        }

        for (const query of queries) {
          const result = resolveCard(allCards, query);
          if (result.matches.length === 1) {
            grantedCards.push(result.matches[0]);
          } else if (result.matches.length > 1) {
            ambiguous.push({ query: result.query, matches: result.matches.slice(0, 8) });
          } else {
            missing.push(result.query);
          }
        }
      }

      if (ambiguous.length) {
        const lines = ambiguous.flatMap(({ query, matches }) => [
          `*${query}* matches more than one card:`,
          ...matches.map((card) => `• ${cardLabel(card)}`),
        ]);
        return reply(`❌ Please use the card ID or add a tier, for example *.gcards ${ambiguous[0].query} | 5 @user*.\n\n${lines.join("\n")}`);
      }
      if (!grantedCards.length) {
        return reply(`❌ No valid cards were found.${missing.length ? `\n\nNot found: ${missing.join(", ")}` : ""}`);
      }

      const user = await findOrCreateUser(targetJid);
      user.cards = Array.isArray(user.cards) ? user.cards : [];
      user.cards.push(...grantedCards.map(ownedCard));
      user.totalCards = (user.totalCards || 0) + grantedCards.length;
      await user.save();

      const preview = grantedCards.slice(0, 20).map((card) => `• ${formatCardLabel(card)}`).join("\n");
      const remaining = grantedCards.length - Math.min(grantedCards.length, 20);
      const missingText = missing.length ? `\n\n⚠️ Not found: ${missing.join(", ")}` : "";
      const remainingText = remaining > 0 ? `\n• ...and ${remaining} more` : "";
      const modeLabel = mode === "series" ? `series *${grantedCards[0].series}*` : `${grantedCards.length === 1 ? "card" : "cards"}`;

      return reply(
`╭━━━〔 🃏 𝐂𝐀𝐑𝐃𝐒 𝐆𝐈𝐕𝐄𝐍 〕━━━╮
┃ 👤 Recipient :: @${uid(targetJid)}
┃ 🎁 Granted   :: ${grantedCards.length} ${modeLabel}
┃ 📚 Collection :: ${user.cards.length}
┃
${preview}${remainingText}${missingText}
╰━━━━━━━━━━━━━━━━━━━━╯`,
        { mentions: [targetJid] },
      );
    } catch (error) {
      console.error("GCARDS ERROR:", error);
      return reply("❌ Card grant failed. The card service or database may be temporarily unavailable; please try again.");
    }
  },
};
