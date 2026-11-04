import { getCardsByTier, formatCardLabel } from "../../lib/cardApi.mjs";

const RARITY_MAP = {
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5",
  "6": "6", "s": "S", "c": "C", "r": "R", "sr": "SR",
  "ssr": "SSR", "ur": "UR", "x": "X",
  "common":    "1",
  "uncommon":  "2",
  "rare":      "3",
  "epic":      "4",
  "legendary": "5",
  "mythical":  "6",
  "secret":    "S",
};

export default {
  name: "clist",
  aliases: ["cardslist", "cl"],
  category: "cards",
  description: "List all cards by tier",
  usage: ".clist <tier> [page]",

  async run({ sock, msg, args }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      if (!args[0]) {
        return reply(
`❌ Usage: .clist <tier> [page]

1 = Common
2 = Uncommon
3 = Rare
4 = Epic
5 = Legendary
6 = Mythical
S = Secret
C, R, SR, SSR, UR, X = higher tiers

Example: .clist 3  or  .clist rare 2  or  .clist UR`
        );
      }

      const input  = args[0].toLowerCase();
      const tierNum = RARITY_MAP[input];
      if (!tierNum) return reply("Invalid tier. Use 1–6, S, C, R, SR, SSR, UR, X, or a tier name.");

      let page = parseInt(args[1]) || 1;
      if (page < 1) page = 1;

      const cards = await getCardsByTier(tierNum);
      if (!cards.length) return reply("❌ No cards found for that tier.");

      const limit      = 50;
      const totalPages = Math.ceil(cards.length / limit);
      if (page > totalPages) page = totalPages;

      const start = (page - 1) * limit;
      const slice = cards.slice(start, start + limit);
      let text =
`〔 *${slice[0]?.tier?.toUpperCase() || "CARDS"} LIST* 〕

  📦 *Total: ${cards.length}*  〔 *Page ${page}/${totalPages}* 〕
  ━━━━━━━━━━━━━━━━━━━━━━━

`;
      slice.forEach((card, i) => {
        text += `  *${card.claimId || card.index}.* ${formatCardLabel(card)}\n`;
      });

      text += `\n  _Use .clist <tier> <page> for more_`;
      text += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      return reply(text);

    } catch (err) {
      console.error("CLIST ERROR:", err);
      return reply(" Failed to load card list.");
    }
  },
};
