import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds, checkLevelUp } from "./database.js";
import { randomChoice } from "../../lib/gambling.mjs";
import { parseAmount } from "./parseAmount.js";
import { MAX_BET, MAX_BET_LABEL, maxBetMessage } from "./bettingLimits.js";
import { getNewlyUnlockedRole, buildLevelUpMsg } from "../../lib/levelRoles.mjs";
import { formatGamblingResult } from "../../lib/gamblingFormat.mjs";
import { getBettingTier } from "./currency.js";
import { membershipWinRate } from "../../lib/membershipBenefits.mjs";
import { economyWinRate } from "../../lib/economyOdds.mjs";

const COOLDOWN = 5 * 60 * 1000;

function fmt(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "gamble",
  aliases: ["bet2", "gbl"],
  category: "economy",
  cooldown: 6,
  description: "Gamble your cash using amount-based money tiers (5 min cooldown)",
  usage: ".gamble <amount|all|half>",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();
    const user  = await getUser(sender);

    if (now - (user.lastGamble || 0) < COOLDOWN) {
      const rem  = COOLDOWN - (now - user.lastGamble);
      const mins = Math.floor(rem / 60000);
      const secs = Math.floor((rem % 60000) / 1000);
      return reply(
`╭─❀「 🎰 *𝐆𝐀𝐌𝐁𝐋𝐄* 」❀─╮
│ ⏳ *Cooldown!*
│ Try again in *${mins}m ${secs}s*.
╰───────────────❀`
      );
    }

    if (!args[0]) return reply(
`╭─❀「 🎰 *𝐆𝐀𝐌𝐁𝐋𝐄* 」❀─╮
│ Usage: *.gamble <amount|all|half>*
│ Max bet: *${MAX_BET_LABEL}*
 │ Betting tiers: *50% ×1.7 → 9% ×10*
│
│ 💰 *Wallet* :: *${fmt(user.money)}*
╰───────────────❀`
    );

    const input  = args[0].toLowerCase();
    let   amount = parseAmount(input, user.money);

    if (isNaN(amount) || amount <= 0) return reply("❌ Enter a valid amount.");
    if (amount > MAX_BET)             return reply(maxBetMessage());
    if (amount > user.money)          return reply(`❌ You only have *${fmt(user.money)}* in your wallet.`);
    if (amount < 10)                  return reply("❌ Minimum bet is $10.");

    user.lastGamble = now;

    const tier = getBettingTier(amount);
    const won = Math.random() < economyWinRate(
      membershipWinRate(tier.winRate, user.membershipTier),
      user,
    );
    const payout = Math.floor(amount * tier.multiplier);
    const netWin = payout - amount;
    const diamondReward = maybeAwardDiamonds(user, won ? 0.003 : 0.001, 1, 2);

    const FACES = ["🎰 🍒 🍋 💎", "🎰 💎 💎 🍒", "🎰 🍀 🍋 🍋",
                   "🎰 🎯 🎯 💥", "🎰 💀 🍒 🍀", "🎰 7️⃣  7️⃣  🍋"];
    const spin  = randomChoice(FACES);
    const tag   = user.name || sender.split("@")[0].split(":")[0];

    if (won) {
      user.money = (user.money || 0) + netWin;
      user.xp    = (user.xp || 0) + 12;

      const { leveled, startLevel, newLevel } = checkLevelUp(user);
      await saveUser(sender, user);
      await addHistory(sender, "slots", netWin, `Gamble win +$${netWin.toLocaleString()} at ×${tier.multiplier}`);

      await reply(formatGamblingResult({
        icon: "🎰",
        title: "Gamble",
        won: true,
        bet: amount,
        got: spin,
        details: [diamondReward ? `💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
        net: netWin,
        balance: user.money,
      }));

      if (leveled) {
        const newRole = getNewlyUnlockedRole(startLevel, newLevel);
        await sock.sendMessage(jid, { text: buildLevelUpMsg(tag, startLevel, newLevel, newRole) }, { quoted: msg });
      }
    } else {
      user.money = Math.max(0, (user.money || 0) - amount);
      await saveUser(sender, user);
      await addHistory(sender, "slots", -amount, `Gamble loss -$${amount.toLocaleString()}`);

      await reply(formatGamblingResult({
        icon: "🎰",
        title: "Gamble",
        bet: amount,
        got: spin,
        details: [diamondReward ? `💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}` : ""],
        net: -amount,
        balance: user.money,
      }));
    }
  },
};
