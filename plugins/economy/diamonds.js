import { getUser, saveUser, requireRegistration, addHistory } from "./database.js";

const CRYSTAL_SELL_PRICE = 200_000; // $200,000 per Genesis Crystal

export default {
  name: "crystals",
  aliases: ["crystal", "genesiscrystals", "diamonds", "diamond", "gems", "gem"],
  category: "economy",
  cooldown: 5,
  description: "Check or sell Genesis Crystals",
  usage: ".crystals  |  .crystals sell <amount|all>",

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const user  = await getUser(sender);
    const sub   = (args[0] || "").toLowerCase();

    // ── SELL ─────────────────────────────────────────────────────────────────
    if (sub === "sell") {
      const owned = user.genesisCrystals || 0;
      if (owned <= 0) return reply("❌ You have no Genesis Crystals to sell.");

      const rawAmt = (args[1] || "all").toLowerCase();
      let qty;
      if (rawAmt === "all") {
        qty = owned;
      } else {
        qty = parseInt(rawAmt, 10);
        if (isNaN(qty) || qty <= 0) return reply("❌ Enter a valid amount. Example: *.crystals sell 3*");
        if (qty > owned) return reply(`❌ You only have *${owned}* Genesis Crystal${owned === 1 ? "" : "s"}.`);
      }

      const payout = qty * CRYSTAL_SELL_PRICE;
      user.genesisCrystals = owned - qty;
      user.money    = (user.money || 0) + payout;

      await saveUser(sender, user);
      await addHistory(sender, "sell", payout, `Sold ${qty} Genesis Crystal${qty === 1 ? "" : "s"} for $${payout.toLocaleString()}`);

      return reply(
`💎 *GENESIS CRYSTALS SOLD*

💎 Sold      : ${qty} Genesis Crystal${qty === 1 ? "" : "s"}
💰 Received  : *+$${payout.toLocaleString()}*
💰 Wallet    : $${user.money.toLocaleString()}
💎 Remaining : ${user.genesisCrystals} Genesis Crystal${user.genesisCrystals === 1 ? "" : "s"}`
      );
    }

    // ── BALANCE ───────────────────────────────────────────────────────────────
    const owned = user.genesisCrystals || 0;
    return reply(
`💎 *GENESIS CRYSTALS*

You have *${owned.toLocaleString()}* Genesis Crystal${owned === 1 ? "" : "s"}.

Earn them from lucky activities, or spend them on special items in the website Shop.

💰 Sell value: *$200,000 each*
Use *.crystals sell <amount|all>* to cash out.`
    );
  },
};
