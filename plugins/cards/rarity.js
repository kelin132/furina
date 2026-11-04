export default {
  name: "rarity",
  aliases: ["rrt", "tiers"],
  category: "cards",
  description: "View the card rarity system and spawn chances",
  usage: ".rarity",

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;

    const text =
`🃏 *CARD RARITY SYSTEM*

━━━━━━━━━━━━━━━

*1 Common*      · weight 38
*2 Uncommon*    · weight 24
*3 Rare*        · weight 17
*4 Epic*        · weight 10
*5 Legendary*   · weight 6
*6 Mythical*    · weight 4
*S Secret*      · weight 1
*C*             · weight 0.5
*R*             · weight 0.3
*SR*            · weight 0.15
*SSR*           · weight 0.05
*UR*            · weight 0.02
*X*             · weight 0.01

Weights are relative; higher tiers are much less likely.

━━━━━━━━━━━━━━━

📌 Notes:
• Higher tier = lower spawn chance
• Event-tagged cards are not included in the spawn catalog
• Cards auto-spawn every 15 min in enabled groups
• Use *.claim <ID>* to grab a spawned card
• Use *.cardspawn on* to enable spawns in your group`;

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
