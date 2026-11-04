import { findOrCreateUser } from "./db.js";
import { formatCardLabel } from "../../lib/cardApi.mjs";

export default {
  name: "col",
  aliases: ["mycol", "mycards"],
  category: "cards",
  description: "View your card collection",
  usage: ".col [page]",

  async run({ sock, msg, sender, args }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const user = await findOrCreateUser(sender);

      if (!Array.isArray(user.cards) || user.cards.length === 0) {
        return reply(
`you don't have any cards yet`
        );
      }

      const limit      = 20;
      let   page       = parseInt(args[0]) || 1;
      const total      = user.cards.length;
      const totalPages = Math.ceil(total / limit);
      if (page < 1) page = 1;
      if (page > totalPages) page = totalPages;

      const start = (page - 1) * limit;
      const slice = user.cards.slice(start, start + limit);

      let cardLines = slice
        .map((card, i) => `│  \`${start + i + 1}.\` ${formatCardLabel(card)}`)
        .join("\n");

      let text =
`╭─❀「 🃏 *𝐂𝐎𝐋𝐋𝐄𝐂𝐓𝐈𝐎𝐍* 」❀─╮
│ 👤 *User*    :: \`@${sender.split("@")[0]}\`
│ 📦 *Cards*   :: \`${total} card${total !== 1 ? "s" : ""}\`
│ 📄 *Page*    :: \`${page} / ${totalPages}\`
│
${cardLines}`;

      if (totalPages > 1) {
        text += `\n│\n│ 💡 \`.col <page>\` to see more`;
      }

      text += `\n╰───────────────❀`;

      return sock.sendMessage(jid, { text, mentions: [sender] }, { quoted: msg });

    } catch (err) {
      return reply(
`Failed to load your collection`
      );
    }
  },
};
