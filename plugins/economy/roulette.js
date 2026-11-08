/**
 * KELIN MD — .roulette
 * Bet on red, black, even, odd, or a specific number (0-36).
 * Usage: .roulette <red|black|even|odd|0-36> <amount>
 */
import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds } from "./database.js";
import { randomInt } from "../../lib/gambling.mjs";
import { parseAmount } from "./parseAmount.js";
import { MAX_BET, maxBetMessage } from "./bettingLimits.js";
import { formatGamblingResult } from "../../lib/gamblingFormat.mjs";

const COOLDOWN = 20 * 1000; // 20 seconds

const RED_NUMBERS = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);

function spinWheel() { return randomInt(0, 36); }
function getColor(n) {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

const COLOR_EMOJI = { red: "🔴", black: "⚫", green: "🟢" };

function fmt(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "roulette",
  aliases: ["rl", "spin"],
  category: "economy",
  cooldown: 6,
  description: "Bet on the roulette wheel — red/black/even/odd or a specific number",
  usage: ".roulette <red|black|even|odd|0-36> <amount>",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();
    const user  = await getUser(sender);

    // ── Cooldown ─────────────────────────────────────────────────────────────
    if (now - (user.lastRoulette || 0) < COOLDOWN) {
      const secs = Math.ceil((COOLDOWN - (now - user.lastRoulette)) / 1000);
      return reply(
`╭─❀「 🎡 *𝐑𝐎𝐔𝐋𝐄𝐓𝐓𝐄* 」❀─╮
│ ⏳ *Result*  :: *SPINNING 🔴*
│ 🍃 *Flavour* :: _まだ回ってる！待って！_
│
│ 🕐 *Next*    :: *${secs}s remaining*
╰───────────────❀`
      );
    }

    if (!args[0]) {
      return reply(
`╭─❀「 🎡 *𝐑𝐎𝐔𝐋𝐄𝐓𝐓𝐄* 」❀─╮
│ 📖 *Usage*   :: *.roulette <bet> <amount>*
│
│ 🎯 *Bet Types & Payouts:*
│   🔴 *red*   — ×2  (1,3,5...36)
│   ⚫ *black* — ×2  (2,4,6...35)
│   *even*  — ×2  (2,4,6...36)
│   *odd*   — ×2  (1,3,5...35)
│   *0-36*  — ×36 (exact number)
│
│ 💡 Example: *.roulette red 500*
│ 💡 Example: *.roulette 7 1000*
│ 💰 *Wallet*  :: *${fmt(user.money)}*
╰───────────────❀`
      );
    }

    const betType  = args[0].toLowerCase();
    const rawAmt   = (args[1] || "").toLowerCase();

    if (!rawAmt) return reply("❌ Usage: *.roulette <bet_type> <amount>*");

    let amount = parseAmount(rawAmt, user.money);
    if (!amount || isNaN(amount) || amount < 50) return reply("❌ Minimum bet is *$50*.");
    if (amount > MAX_BET) return reply(maxBetMessage());
    if (amount > user.money) return reply(`❌ You only have *${fmt(user.money)}*.`);

    const validSimple = ["red", "black", "even", "odd"];
    const numBet      = parseInt(betType, 10);
    const isNumBet    = !isNaN(numBet) && numBet >= 0 && numBet <= 36;

    if (!validSimple.includes(betType) && !isNumBet) {
      return reply("❌ Invalid bet type.\n\nChoose: *red*, *black*, *even*, *odd*, or a number *0-36*.");
    }

    // ── Spin! ─────────────────────────────────────────────────────────────────
    user.lastRoulette = now;
    const result      = spinWheel();
    const color       = getColor(result);
    const isEven      = result !== 0 && result % 2 === 0;
    const emoji       = COLOR_EMOJI[color];

    let won = false;
    let multiplier = 0;

    if (isNumBet) {
      won = result === numBet; multiplier = 36;
    } else if (betType === "red") {
      won = color === "red"; multiplier = 2;
    } else if (betType === "black") {
      won = color === "black"; multiplier = 2;
    } else if (betType === "even") {
      won = isEven; multiplier = 2;
    } else if (betType === "odd") {
      won = result !== 0 && !isEven; multiplier = 2;
    }

    if (result === 0 && !isNumBet) won = false;

    const winnings = won ? amount * multiplier : 0;
    const net      = winnings - amount;
    user.money     = Math.max(0, user.money + net);
    user.xp        = (user.xp || 0) + 8;
    const diamondReward = maybeAwardDiamonds(user, won && multiplier >= 36 ? 0.008 : won ? 0.002 : 0.001, 1, 2);

    await saveUser(sender, user);
    await addHistory(sender, "roulette", net, `Roulette: ${betType} $${amount.toLocaleString()}`);

    const ballLine = `${result} ${emoji} (${color === "green" ? "Green" : color === "red" ? "Red" : "Black"})`;
    const bonus = diamondReward ? `💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}` : "";

    return reply(formatGamblingResult({
      icon: "🎡",
      title: "Roulette",
      won,
      betLabel: `Bet: ${betType} ×`,
      bet: amount,
      got: ballLine,
      details: [bonus],
      net,
      balance: user.money,
    }));
  },
};
