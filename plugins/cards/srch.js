import { getCard, searchCards, formatCardLabel, sendCardMedia } from "../../lib/cardApi.mjs";

export default {
  name: "search",
  aliases: ["cardfind", "csearch"],
  category: "cards",
  description: "Search a card by name or ID and preview it",
  usage: ".search <name or ID>",

  async run({ sock, msg, args, text: rawText }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const query = (rawText || args.join(" ")).trim();
      if (!query) return reply("❌ Give a card name or ID.\nExample: .search rimuru");

      const card = await getCard(query);

      if (!card) {
        const similar = await searchCards(query, 5);
        if (similar.length) {
          let suggest = `❌ Card not found for "${query}".\n\nDid you mean:\n\n`;
          similar.forEach((c, i) => { suggest += `${i + 1}. ${c.name} (#${c.claimId || c.index})\n`; });
          return reply(suggest);
        }
        return reply(`❌ No card found matching "${query}".`);
      }

      const text =
`ㅤㅤ∘]───❀───[∘
*∘₊✧ CARD INFO* ❀
     ∘]───❀───[∘

𝗖𝗮𝗿𝗱: ${formatCardLabel(card)}
𝗣𝗿𝗶𝗰𝗲: $${card.price.toLocaleString()}
𝗜𝗗: ${card.claimId || card.index}
𝗦𝗲𝗿𝗶𝗲𝘀: ${card.series}

  *❀────⋆⋅∘⋅⋆────❀*
 *CARD PREVIEW*
  *❀────⋆⋅∘⋅⋆────❀*
      ∘──────∘`;

      if (card.media) {
        return sendCardMedia(sock, jid, card, text, { quoted: msg });
      }

      return reply(text);

    } catch (err) {
      console.error("SEARCH ERROR:", err);
      return reply("❌ Search failed.");
    }
  },
};
