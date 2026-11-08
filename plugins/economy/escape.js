import { addHistory, getUser, saveUser, unjailUser } from "./database.js";

export default {
  name: "escape",
  aliases: ["getaway"],
  category: "economy",
  description: "Use a Getaway Tool to leave jail",
  usage: ".escape",

  async run({ sock, msg, sender }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });
    const user = await getUser(sender);
    const remaining = Number(user.jailUntil) - Date.now();
    if (!user.jailed || remaining <= 0) {
      if (user.jailed) await unjailUser(sender);
      return reply("You are not in jail.");
    }
    const inventory = Array.isArray(user.inventory) ? user.inventory : [];
    const itemIndex = inventory.indexOf("getaway_tool");
    if (itemIndex < 0) return reply("You need a Getaway Tool from .shop, or wait for your jail timer to end.");
    inventory.splice(itemIndex, 1);
    user.inventory = inventory;
    await saveUser(sender, user);
    await unjailUser(sender);
    await addHistory(sender, "escape", 0, "Used a Getaway Tool to leave jail");
    return reply("You used a Getaway Tool and left jail.");
  },
};
