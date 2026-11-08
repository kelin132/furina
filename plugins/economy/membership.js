import { getEconomyPreviewConfig } from "../../lib/economyPreview.mjs";

export default {
  name: "membership",
  aliases: ["member"],
  category: "economy",
  description: "View Basic and Premium membership benefits",
  usage: ".membership",

  async run({ sock, msg }) {
    const url = getEconomyPreviewConfig("membership")?.url ?? "https://aidoru.zone.id/membership";
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: `AIDORU Membership tiers and benefits:\n${url}` },
      { quoted: msg },
    );
  },
};
