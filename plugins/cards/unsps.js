import { getTierCounts, TIER_NAME } from "../../lib/cardApi.mjs";

export default {
  name: "unsps",
  aliases: ["unspawned", "cardstats"],
  category: "cards",
  description: "Shows card counts per tier (from the card API)",
  usage: ".unsps",

  async run({ sock, msg }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    try {
      const activeSpawns = global.activeSpawns || {};
      const activeIds    = Object.values(activeSpawns).map(s => s.cardId).filter(Boolean);

      const counts = await getTierCounts();
      const tiers  = Object.values(TIER_NAME);
      const total  = Object.values(counts).reduce((a, b) => a + b, 0);

      let text = `🎴 *CARD POOL STATS*\n\n`;
      for (const tier of tiers) {
        text += `*${tier}:* ${(counts[tier] || 0).toLocaleString()}\n`;
      }
      text += `\n📦 *Total cards in pool:* ${total.toLocaleString()}`;

      if (activeIds.length) {
        text += `\n🔴 *Currently spawned:* ${activeIds.length}`;
      }

      return reply(text);

    } catch (err) {
      console.error("UNSPS ERROR:", err);
      return reply("❌ Failed to load card stats.");
    }
  },
};
