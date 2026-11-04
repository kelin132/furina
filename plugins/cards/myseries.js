/**
 * .myseries           — list all series you have cards from (with counts)
 * .myseries <name>    — view cards in a specific series
 * .si <card name>     — show card owners and preview
 * .ci <card name>     — show card details
 */
import { findOrCreateUser } from "./db.js";
import { formatCardLabel, TIER_NAME } from "../../lib/cardApi.mjs";

const TIER_ORDER = [...Object.values(TIER_NAME)].reverse();

export default {
  name:     "myseries",
  aliases:  ["series", "mysets", "seriescol"],
  category: "cards",
  description: "See which card series you're collecting",
  usage:    ".myseries  |  .myseries <series name>",

  async run({ sock, msg, sender, text }) {
    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t, mentions: [sender] }, { quoted: msg });

    try {
      const user = await findOrCreateUser(sender);

      if (!Array.isArray(user.cards) || user.cards.length === 0) {
        return reply("❌ You don't have any cards yet.\n\nWait for a spawn and type *.claim <ID>* to grab one!");
      }

      // Group cards by series
      const grouped = {};
      for (const card of user.cards) {
        const series = (card.series || "Unknown").trim();
        if (!grouped[series]) grouped[series] = [];
        grouped[series].push(card);
      }

      const filter = (text || "").trim().toLowerCase();

      // ── View a specific series ────────────────────────────────────────────
      if (filter) {
        const key = Object.keys(grouped).find(
          (s) => s.toLowerCase() === filter || s.toLowerCase().includes(filter)
        );

        if (!key) {
          const available = Object.keys(grouped).sort().join(", ");
          return reply(
            `❌ No cards found for series "*${text.trim()}*".\n\n` +
            `📚 Your series:\n${available}`
          );
        }

        const cards = grouped[key];
        // Sort by tier (best first), then name
        cards.sort((a, b) => {
          const ai = TIER_ORDER.indexOf(a.tier);
          const bi = TIER_ORDER.indexOf(b.tier);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || (a.name || "").localeCompare(b.name || "");
        });

        let out = `📚 *Series: ${key}*\n`;
        out    += `@${sender.split("@")[0]} — ${cards.length} card${cards.length !== 1 ? "s" : ""}\n\n`;

        cards.forEach((card, i) => {
          out += `${i + 1}. ${formatCardLabel(card)}\n`;
        });

        out += `\n\n💡 Use *.ci <card name or index>* for card details.`;
        out += `\n💡 Use *.si <card name>* for owners and a preview.`;

        return sock.sendMessage(jid, { text: out, mentions: [sender] }, { quoted: msg });
      }

      // ── Overview: all series ──────────────────────────────────────────────
      const sortedSeries = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length);

      const totalSeries = sortedSeries.length;
      const totalCards  = user.cards.length;

      let out = `📚 *SERIES OVERVIEW*\n`;
      out    += `@${sender.split("@")[0]} — ${totalCards} card${totalCards !== 1 ? "s" : ""} across ${totalSeries} series\n`;
      out    += "─".repeat(28) + "\n\n";

      for (const [series, cards] of sortedSeries) {
        // Count tiers within this series
        const tierCounts = {};
        for (const card of cards) {
          const t = card.tier || "Common";
          tierCounts[t] = (tierCounts[t] || 0) + 1;
        }

        // Build tier breakdown (best tiers first, skip zeros)
        const breakdown = TIER_ORDER
          .filter((t) => tierCounts[t])
          .map((t) => `${t}×${tierCounts[t]}`)
          .join(" ");

        out += `*${series}*\n`;
        out += `  📦 ${cards.length} card${cards.length !== 1 ? "s" : ""}  ${breakdown}\n\n`;
      }

      out += `💡 Type *.myseries <name>* to see cards in a series.\n`;
      out += `💡 Use *.si <card name>* for owners and a preview.\n`;
      out += `💡 Use *.ci <card name or index>* for card details.`;

      return sock.sendMessage(jid, { text: out, mentions: [sender] }, { quoted: msg });

    } catch (err) {
      console.error("MYSERIES ERROR:", err);
      return reply("❌ Failed to load your series data.");
    }
  },
};
