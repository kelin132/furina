/**
 * KELIN MD — .coinflip
 * Call heads or tails — 55% win rate.
 * Usage: .coinflip <heads|tails> <amount>
 */
import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds, checkLevelUp } from "./database.js";
import { randomChance } from "../../lib/gambling.mjs";
import { parseAmount } from "./parseAmount.js";
import { MAX_BET, maxBetMessage } from "./bettingLimits.js";
import { getNewlyUnlockedRole, buildLevelUpMsg } from "../../lib/levelRoles.mjs";
import { formatGamblingResult } from "../../lib/gamblingFormat.mjs";

const COOLDOWN = 8 * 1000;

function fmt(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "coinflip",
  aliases: ["cf", "flip2"],
  category: "economy",
  cooldown: 6,
  description: "Flip a coin — call it right to double your money! (55% win)",
  usage: ".coinflip <heads|tails> <amount>",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();
    const user  = await getUser(sender);

    if (now - (user.lastCoinflip || 0) < COOLDOWN) {
      const secs = Math.ceil((COOLDOWN - (now - user.lastCoinflip)) / 1000);
      return reply(`💰 Coin still in the air! Try in *${secs}s*.`);
    }

    const call   = (args[0] || "").toLowerCase();
    const rawAmt = (args[1] || "").toLowerCase();

    if (!["heads", "tails", "h", "t"].includes(call) || !rawAmt) {
      return reply(
`╭─❀「 💰 𝐂𝐎𝐈𝐍 𝐅𝐋𝐈𝐏 」❀─╮
│ Usage  : *.coinflip <heads|tails> <amount>*
│ Example: .coinflip h 1b
│ Maximum: *$5M*
│
│ 🎯 *Win Rate* :: *55%*
│ 💰 *Win*      :: *×2 your bet*
│ 💰 *Wallet*   :: *${fmt(user.money)}*
╰───────────────❀`
      );
    }

    const normalCall = call === "h" ? "heads" : call === "t" ? "tails" : call;
    let amount = parseAmount(rawAmt, user.money);
    if (!amount || isNaN(amount) || amount < 10) return reply("❌ Minimum bet is *$10*.");
    if (amount > MAX_BET) return reply(maxBetMessage());
    if (amount > user.money) return reply(`❌ You only have *${fmt(user.money)}*.`);

    user.lastCoinflip = now;

    const won    = randomChance(0.55);
    const result = won ? normalCall : (normalCall === "heads" ? "tails" : "heads");
    const diamondReward = maybeAwardDiamonds(user, won ? 0.003 : 0.001, 1, 2);
    const coinEmoji = result === "heads" ? "💰 Heads" : "🌑 Tails";
    const tag   = user.name || sender.split("@")[0].split(":")[0];

    if (won) {
      user.money += amount;
      user.xp     = (user.xp || 0) + 8;

      const { leveled, startLevel, newLevel } = checkLevelUp(user);
      await saveUser(sender, user);
      await addHistory(sender, "coinflip", amount, `Coinflip win: ${normalCall}`);

      await reply(formatGamblingResult({
        icon: "💰",
        title: "Coin Flip",
        won: true,
        betLabel: `Bet: ${normalCall} ×`,
        bet: amount,
        got: coinEmoji,
        details: [`💎 Reward: ${fmt(amount * 2)}`, diamondReward ? `💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
        net: amount,
        balance: user.money,
      }));

      if (leveled) {
        const newRole = getNewlyUnlockedRole(startLevel, newLevel);
        await sock.sendMessage(jid, { text: buildLevelUpMsg(tag, startLevel, newLevel, newRole) }, { quoted: msg });
      }
    } else {
      user.money = Math.max(0, user.money - amount);
      await saveUser(sender, user);
      await addHistory(sender, "coinflip", -amount, `Coinflip loss: ${normalCall}`);

      await reply(formatGamblingResult({
        icon: "💰",
        title: "Coin Flip",
        betLabel: `Bet: ${normalCall} ×`,
        bet: amount,
        got: coinEmoji,
        details: [diamondReward ? `💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
        net: -amount,
        balance: user.money,
      }));
    }
  },
};
