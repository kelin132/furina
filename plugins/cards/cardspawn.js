import { isSpawnEnabled, setSpawnEnabled } from "./db.js";

export default {
  name: "cards",
  aliases: ["cardspawn", "spawncard", "cardauto"],
  description: "Enable or disable automatic card spawning every 12–15 minutes",
  category: "cards",
  usage: ".cards on | .cards off | .cards status",
  isAdmin: true,
  isOwner: true,

  async run({ sock, msg, args }) {
    const chatId = msg.key.remoteJid;

    if (!chatId.endsWith("@g.us")) {
      await sock.sendMessage(chatId, { text: "❌ This command only works in groups." }, { quoted: msg });
      return;
    }

    const sub = (args[0] ?? "status").toLowerCase();

    if (sub === "status") {
      const enabled = await isSpawnEnabled(chatId);
      await sock.sendMessage(chatId, {
        text: `🃏 *Auto Card Spawn*\n\nStatus: ${enabled ? "✅ *ON*" : "❌ *OFF*"}\nInterval: every *12–15 minutes*\n\nUse *.cards on* / *.cards off* to change.`,
      }, { quoted: msg });
      return;
    }

    if (sub === "on") {
      await setSpawnEnabled(chatId, true);
      await sock.sendMessage(chatId, {
        text: "Card spawning is on. A card will appear every 12–15 minutes.",
      }, { quoted: msg });
      return;
    }

    if (sub === "off") {
      await setSpawnEnabled(chatId, false);
      await sock.sendMessage(chatId, {
        text: "Card spawning is off.",
      }, { quoted: msg });
      return;
    }

    await sock.sendMessage(chatId, {
      text: "Usage: *.cards on* | *.cards off* | *.cards status*",
    }, { quoted: msg });
  },
};
