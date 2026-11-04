import { isSpawnEnabled, setSpawnEnabled } from "./db.js";

export default {
  name: "cardspawn",
  aliases: ["spawncard", "cardauto"],
  description: "Enable or disable automatic card spawning every 12–15 minutes",
  category: "cards",
  usage: ".cardspawn on | .cardspawn off | .cardspawn status",
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
        text: `🃏 *Auto Card Spawn*\n\nStatus: ${enabled ? "✅ *ON*" : "❌ *OFF*"}\nInterval: every *12–15 minutes*\n\nUse *.cardspawn on* / *.cardspawn off* to change.`,
      }, { quoted: msg });
      return;
    }

    if (sub === "on") {
      await setSpawnEnabled(chatId, true);
      await sock.sendMessage(chatId, {
        text:
          `Card spawning is now on. A card will appear every *12–15 minutes*; use *.claim <number>* to collect it.`,
      }, { quoted: msg });
      return;
    }

    if (sub === "off") {
      await setSpawnEnabled(chatId, false);
      await sock.sendMessage(chatId, {
        text: "❌ *Auto Card Spawn: OFF*\n\nNo more automatic cards in this group.",
      }, { quoted: msg });
      return;
    }

    await sock.sendMessage(chatId, {
      text: "❌ Usage: *.cardspawn on* | *.cardspawn off* | *.cardspawn status*",
    }, { quoted: msg });
  },
};
