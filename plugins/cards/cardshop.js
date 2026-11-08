import { getEconomyPreviewConfig } from "../../lib/economyPreview.mjs";

export default {
  name: "cardshop",
  aliases: ["cardmarket"],
  category: "cards",
  description: "Browse upcoming card auctions and bid",
  usage: ".cardshop",

  async run({ sock, msg }) {
    const url = getEconomyPreviewConfig("cardshop")?.url ?? "https://aidoru.zone.id/auction";
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `AIDORU Card Marketplace:\n${url}` },
      { quoted: msg },
    );
  },
};
