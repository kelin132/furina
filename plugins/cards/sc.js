import { searchCards, formatCardLabel } from "../../lib/cardApi.mjs";
import { Col } from "./db.js";

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export default {
  name: "sc",
  aliases: ["cardsearch"],
  category: "cards",
  description: "Search cards by name with owner info",
  usage: ".sc <name> [page]",

  async run({ sock, msg, args }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      if (!args.length) return reply("❌ Give a name to search.\nExample: .sc rimuru");

      let page = 1;
      if (args.length > 1 && !isNaN(args[args.length - 1])) {
        page = Math.max(1, parseInt(args.pop()));
      }

      const query = args.join(" ").trim();
      if (!query) return reply("❌ Invalid search query.");

      const limit   = 10;
      const allHits = await searchCards(query, 200);
      if (!allHits.length) return reply(`❌ No cards found for "${query}"`);

      const total      = allHits.length;
      const totalPages = Math.ceil(total / limit);
      if (page > totalPages) page = totalPages;

      const slice = allHits.slice((page - 1) * limit, page * limit);

      // Build owner map for cards in this slice
      const cardIds = slice.map(c => c.cardId);
      let ownerMap  = new Map();
      try {
        const userCol = await Col.users();
        const users   = await userCol.find(
          { "cards.cardId": { $in: cardIds } },
          { projection: { userId: 1, username: 1, "cards.cardId": 1 } }
        ).toArray();

        for (const u of users) {
          const label = u.username || `@${u.userId}`;
          const counts = new Map();
          for (const c of (u.cards || [])) {
            if (cardIds.includes(c.cardId)) {
              counts.set(c.cardId, (counts.get(c.cardId) || 0) + 1);
            }
          }
          for (const [cardId, count] of counts) {
            if (!ownerMap.has(cardId)) ownerMap.set(cardId, []);
            ownerMap.get(cardId).push(`${label}${count > 1 ? ` (x${count})` : ""}`);
          }
        }
      } catch { /* DB offline — skip owner info */ }

      let text =
`ㅤㅤ∘]───❀───[∘
*∘₊✧ CARD SEARCH* ❀
     ∘]───❀───[∘

𝗤𝘂𝗲𝗿𝘆: ${query}
𝗣𝗮𝗴𝗲: ${page}/${totalPages}
𝗧𝗼𝘁𝗮𝗹: ${total}

━━━━━━━━━━━━━━━`;

      for (const c of slice) {
        const owners = ownerMap.get(c.cardId) || [];
        const ownerList = owners.length
          ? owners.slice(0, 3).join(", ") + (owners.length > 3 ? ` +${owners.length - 3}` : "")
          : "No one yet";

        text +=
`

${formatCardLabel(c)}
📺 Series: ${c.series}
🆔 ID: \`${c.cardId}\`
👥 Owners: ${ownerList}`;
      }

      text += `\n\n_Use .sc ${query} <page> to see more_`;

      return reply(text);

    } catch (err) {
      console.error("SC ERROR:", err);
      return reply("❌ Search failed.");
    }
  },
};
