import { readFile } from "node:fs/promises";
import { getRuntimeSettings } from "../../lib/runtimeSettings.mjs";

const WEBSITE_URL = "https://aidoru.zone.id/";
const PREVIEW_IMAGE_URL = new URL("../../assets/aidoru-web-preview.jpg", import.meta.url);
let previewThumbnailPromise;

function getPreviewThumbnail() {
  if (!previewThumbnailPromise) {
    previewThumbnailPromise = readFile(PREVIEW_IMAGE_URL).catch(() => null);
  }
  return previewThumbnailPromise;
}

function getBotName() {
  const runtime = getRuntimeSettings();
  return runtime.botName || process.env.BOT_NAME || "AIDORU Bot";
}

function buildInfoMessage() {
  return `𝗔𝗜𝗗𝗢𝗥𝗨 𝗖𝗢𝗠𝗠𝗨𝗡𝗜𝗧𝗬

Hi, my name is ${getBotName()}. I am a private anime community bot created to help trainers, collectors, and Pokémon dreamers explore the AIDORU realm.

𝗢𝗙𝗙𝗜𝗖𝗜𝗔𝗟 𝗖𝗥𝗘𝗗𝗜𝗧𝗦
❀ Owner: \`Kelin\`
❀ Creator: \`AIDORU Team\`
❀ Registered users: \`779\`
❀ created : \`18/07/26\`

𝗖𝗢𝗠𝗠𝗨𝗡𝗜𝗧𝗬 𝗛𝗘𝗟𝗣
Login to our website, visit:
${WEBSITE_URL}

╰─ ୨୧ ────────────────── ୨୧
   ✦ Explore • Collect • Battle ✦
╰──────────────────────────╯`.trim();
}

export default {
  name: "info",
  description: "Display AIDORU Community information",
  category: "main",
  usage: ".info",
  aliases: ["botinfo"],
  cooldown: 10,

  async run({ sock, msg }) {
    const chatId = msg.key.remoteJid || msg.key.participant;
    if (!chatId) return;

    const text = buildInfoMessage();
    const linkPreview = {
      "canonical-url": WEBSITE_URL,
      "matched-text": WEBSITE_URL,
      title: "🌸 AIDORU Community — Your Pokémon World",
      description: "Create your trainer profile, collect cards, raise Pokémon, care for pets and join battle rooms.",
      jpegThumbnail: await getPreviewThumbnail(),
    };

    try {
      return await sock.sendMessage(chatId, { text, linkPreview }, { quoted: msg });
    } catch (error) {
      console.warn("[info] link preview failed; sending visible text fallback:", error?.message || error);
      return sock.sendMessage(chatId, { text }, { quoted: msg });
    }
  },
};
