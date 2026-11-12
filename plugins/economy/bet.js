/**
 * KELIN MD — .bet
 * Gamble a chosen amount of cash. 55% win rate.
 * Usage: .bet <amount|all|half>
 */
import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds, checkLevelUp } from "./database.js";
import { randomChoice } from "../../lib/gambling.mjs";
import { parseAmount } from "./parseAmount.js";
import { MAX_BET, maxBetMessage } from "./bettingLimits.js";
import { getNewlyUnlockedRole, buildLevelUpMsg } from "../../lib/levelRoles.mjs";
import { formatGamblingResult } from "../../lib/gamblingFormat.mjs";
import { getBettingTier } from "./currency.js";
import { membershipWinRate } from "../../lib/membershipBenefits.mjs";
import { economyWinRate } from "../../lib/economyOdds.mjs";

const COOLDOWN = 30 * 1000;

const WIN_LINES  = [
  "Luck is on your side!",
  "Fortune favors the bold!",
  "Huge victory!",
  "Jackpot! You nailed it!",
  "A perfect call!"
];

const LOSE_LINES = [
  "Bummer! You'll get it next time!",
  "So close! Try again!",
  "Luck wasn't with you...",
  "Give it another shot!",
  "Don't give up after a loss!"
];

/** Short money formatter */
function fmt(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "bet",
  description: "Gamble your cash using amount-based money tiers",
  category: "economy",
  usage: ".bet <amount | all | half>  ✦ shorthand OK: 10k / 500k / 5m",
  aliases: ["gamble2", "wager"],
  cooldown: 2,
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid  = msg.key.remoteJid;
    const user = await getUser(sender);
    const now  = Date.now();

    if (now - (user.lastBet || 0) < COOLDOWN) {
      const secs = Math.ceil((COOLDOWN - (now - user.lastBet)) / 1000);
      return sock.sendMessage(jid, {
        text: `⏳ Cooldown! You can bet again in \`${secs}s\`.`,
      }, { quoted: msg });
    }

    const raw = args[0]?.toLowerCase();
    if (!raw) {
      return sock.sendMessage(jid, {
        text:
`╭─❀「 🎲 *𝐁𝐄𝐓* 」❀─╮
│ Usage: \`.bet <amount>\`
│ Examples: \`.bet 500\`  /  \`.bet 10k\`  /  \`.bet 1b\`
│ Maximum: \`$5M\`
│ \`.bet all\` — bet everything in wallet
│ \`.bet half\` — bet half your wallet
│
│ 💰 *Wallet* :: \`${fmt(user.money)}\`
│ 🎯 *Tiers* :: \`45% ×2 · max +$5M net\`
╰───────────────❀`,
      }, { quoted: msg });
    }

    let amount = parseAmount(raw, user.money);
    if (!amount || isNaN(amount) || amount <= 0)
      return sock.sendMessage(jid, { text: "❌ Enter a valid amount. Example: \`.bet 500\`" }, { quoted: msg });
    if (amount > MAX_BET)
      return sock.sendMessage(jid, { text: maxBetMessage() }, { quoted: msg });
    if (amount > user.money)
      return sock.sendMessage(jid, { text: `❌ You only have \`${fmt(user.money)}\` in your wallet.` }, { quoted: msg });
    if (amount < 10)
      return sock.sendMessage(jid, { text: "❌ Minimum bet is \`$10\`." }, { quoted: msg });

    const tier         = getBettingTier(amount);
    const won          = Math.random() < economyWinRate(
      membershipWinRate(tier.winRate, user.membershipTier),
      user,
    );
    const payout       = Math.floor(amount * tier.multiplier);
    const netWin       = payout - amount;
    const diamondReward = maybeAwardDiamonds(user, won ? 0.003 : 0.001, 1, 2);
    const flavour      = randomChoice(won ? WIN_LINES : LOSE_LINES);

    user.lastBet = now;

    if (won) {
      user.money += netWin;
      user.xp     = (user.xp || 0) + 15;

      const { leveled, startLevel, newLevel } = checkLevelUp(user);
      await saveUser(sender, user);
      await addHistory(sender, "bet", netWin, `Bet won — wagered $${amount.toLocaleString()} at ×${tier.multiplier}`);

      const tag = user.name || sender.split("@")[0].split(":")[0];
      await sock.sendMessage(jid, {
        text: formatGamblingResult({
          icon: "🎲",
          title: "Bet",
          won: true,
          bet: amount,
          got: flavour,
          details: [diamondReward ? `💎 Bonus: +\`${diamondReward}\` Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
          net: netWin,
          balance: user.money,
        }),
      }, { quoted: msg });

      if (leveled) {
        const newRole = getNewlyUnlockedRole(startLevel, newLevel);
        await sock.sendMessage(jid, { text: buildLevelUpMsg(tag, startLevel, newLevel, newRole) }, { quoted: msg });
      }
    } else {
      user.money = Math.max(0, user.money - amount);
      await saveUser(sender, user);
      await addHistory(sender, "bet", -amount, `Bet lost — wagered $${amount.toLocaleString()}`);

      await sock.sendMessage(jid, {
        text: formatGamblingResult({
          icon: "🎲",
          title: "Bet",
          bet: amount,
          got: flavour,
          details: [diamondReward ? `💎 Bonus: +\`${diamondReward}\` Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
          net: -amount,
          balance: user.money,
        }),
      }, { quoted: msg });
    }
  },
};