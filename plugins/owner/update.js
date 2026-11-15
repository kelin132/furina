import { updateBot } from "../../lib/gitUpdater.mjs";
import { loadPlugins } from "../../lib/pluginManager.mjs";

let updateInProgress = false;

export default {
  name: "update",
  description: "Update the bot checkout from GitHub safely",
  category: "owner",
  usage: ".update",
  aliases: ["pull", "gitpull"],
  isMod: true,
  cooldown: 30,
  async run({ sock, msg, prefix }) {
    const send = (text) => sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
    if (updateInProgress) return send("⏳ An update is already running.");
    updateInProgress = true;
    try {
      await send("🔄 Checking GitHub for updates…");
      const result = await updateBot();
      if (result.sameRev) return await send("✅ Already up to date.");
      const { totalPlugins, totalCommands } = await loadPlugins(prefix);
      await send(
        `✅ Updated to ${result.newRev.slice(0, 7)}.\n` +
        `${totalPlugins} plugins / ${totalCommands} commands reloaded.\n\n` +
        "Restart the bot from your panel to load changed database and core modules. Sessions and local data were preserved.",
      );
    } catch (error) {
      await send(`❌ Update did not complete: ${error.message}\nCheck that Git is installed and the bot folder is writable, then retry.`);
    } finally {
      updateInProgress = false;
    }
  },
};
