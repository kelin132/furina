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
  description: "Restart the WhatsApp connection without stopping the panel (staff level 2+)",
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

    // Refresh the AI module before reconnecting so a pulled update is active.
    await reloadAkiraAI();

    // Small delay so the message is delivered before the socket reconnects
    await new Promise(r => setTimeout(r, 2000));

    restartConnection();
  },
};
