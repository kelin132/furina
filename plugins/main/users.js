import { getDb } from "../../lib/mongo.mjs";
import { getHarareDayWindow } from "../../lib/harareDayWindow.mjs";

export default {
  name: "users",
  description: "Show total registered users on the bot",
  category: "main",
  usage: ".users",
  aliases: ["totalusers", "usercount"],
  cooldown: 10,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;

    let total = 0;
    let registered = 0;
    let newToday = 0;

    try {
      const db = await getDb();
      const { start, end } = getHarareDayWindow();

      [total, registered, newToday] = await Promise.all([
        db.collection("users").countDocuments(),
        db.collection("users").countDocuments({ registered: true }),
        db.collection("users").countDocuments({
          registered: true,
          $or: [
            { registeredAt: { $gte: start.toISOString(), $lt: end.toISOString() } },
            { registeredAt: { $gte: start, $lt: end } },
            { registeredAt: { $gte: start.getTime(), $lt: end.getTime() } },
          ],
        }),
      ]);
    } catch (err) {
      console.error("[users] MongoDB error:", err.message);
      return sock.sendMessage(jid, {
        text: "❌ Couldn't fetch user stats right now. MongoDB may be unavailable.",
      }, { quoted: msg });
    }

    const text =
`╭━━━〔 👥 *BOT USERS* 〕━━━╮
│ 📋 *Total Accounts* :: *${total.toLocaleString()}*
│ ✅ *Registered*     :: *${registered.toLocaleString()}*
│ 🌱 *Joined Today*   :: *${newToday.toLocaleString()}*
╰━━━━━━━━━━━━━━━━━━━━━━╯`;

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
