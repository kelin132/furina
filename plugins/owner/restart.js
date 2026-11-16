/**
 * KELIN MD — .restart
 * Sends a confirmation message then reconnects WhatsApp in-process.
 * This keeps panel hosts running instead of terminating the application.
 */

import { restartConnection } from "../../lib/bot.mjs";
import { reloadAkiraAI } from "../../lib/akiraHandler.mjs";

export default {
  name: "restart",
  aliases: ["reboot", "rs"],
  description: "Restart the bot connection (staff level 2+)",
  category: "owner",
  usage: ".restart",
  isStaff: true,
  minStaffLevel: 2,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;

    await sock.sendMessage(jid, {
      text:
`╭━━━〔 🔄 *RESTARTING BOT* 〕━━━╮
│
│  ⚡ Bot is restarting…
│  Please wait a few seconds.
│
╰━━━━━━━━━━━━━━━━━━━━━━━━━━╯`,
    }, { quoted: msg });

    // A failed optional AI refresh must not block the requested bot restart.
    try {
      await reloadAkiraAI();
    } catch (err) {
      console.warn("[restart] AI module refresh failed; continuing restart:", err?.message || err);
    }

    // Small delay so the message is delivered before the socket reconnects
    await new Promise(r => setTimeout(r, 2000));

    restartConnection();
  },
};
