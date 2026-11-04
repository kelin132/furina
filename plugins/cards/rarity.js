import { TIER_NAME, TIER_WEIGHTS } from "../../lib/cardApi.mjs";

export default {
  name: "rarity",
  aliases: ["rrt", "tiers"],
  category: "cards",
  description: "View the card rarity system and spawn chances",
  usage: ".rarity",

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;
    const tiers = TIER_WEIGHTS
      .map(({ num, weight }) => `${num}: ${TIER_NAME[num] || `Tier ${num}`} (weight ${weight})`)
      .join("\n");
    const text = `Card tiers\n\n${tiers}\n\n` +
      "Weights are relative; higher tiers are less common.\n" +
      "Any available tier can spawn randomly every 12–15 minutes.\n" +
      "Use .claim <code> to claim a spawned card at its listed value.";

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
