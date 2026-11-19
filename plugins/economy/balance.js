import { getUser, requireRegistration } from "./database.js";
import { bankLimitForUser, formatRyu } from "./currency.js";

export default {
  name: "balance",
  description: "Check your wallet and bank balance",
  category: "economy",
  usage: ".balance",
  aliases: ["bal", "money", "wallet"],
  cooldown: 6,

  async run({ sock, msg, sender }) {
    const user = await getUser(sender);
    if (!await requireRegistration(sock, msg, sender, user)) return;

    const jid  = msg.key.remoteJid;
    const wallet = Number(user.money ?? 0);
    const bank = Number(user.bank ?? 0);
    const text = [
      "💰 𝗔𝗖𝗖𝗢𝗨𝗡𝗧 𝗕𝗔𝗟𝗔𝗡𝗖𝗘",
      "━━━━━━━━━━━━━━━━━",
      `💰 𝗪𝗮𝗹𝗹𝗲𝘁  : ⟦ \`${formatRyu(wallet)}\` ⟧`,
      `🏦 𝗕𝗮𝗻𝗸    : ⟦ \`${formatRyu(bank)} / ${formatRyu(bankLimitForUser(user))}\` ⟧`,
      `💸 𝗧𝗼𝘁𝗮𝗹   : ⟦ \`${formatRyu(wallet + bank)}\` ⟧`,
      "━━━━━━━━━━━━━━━━━",
    ].join("\n");

    await sock.sendMessage(jid, { text, mentions: [sender] }, { quoted: msg });
  },
};
