/**
 * KELIN MD — .invest
 * High-Risk Economy Investment Command
 */
import {
  getUser,
  requireRegistration,
  addHistory,
  startInvestment,
  collectInvestment,
} from "./database.js";
import { economyWinRate } from "../../lib/economyOdds.mjs";

const MAX_INVEST = 90_000_000; // 90 million cap per investment

const PLANS = {
  short: {
    label:      "Short-Term",
    emoji:      "⚡",
    duration:   5 * 60 * 1000,      // 5 minutes
    minRet:     0.03,               // 3% min return
    maxRet:     0.10,               // 10% max return
    lossChance: 0.55,               // 55% crash rate
    minLoss:    0.30,               // 30% min loss
    maxLoss:    0.50,               // 50% max loss
    minAmt:     1000,
  },
  medium: {
    label:      "Medium-Term",
    emoji:      "📊",
    duration:   30 * 60 * 1000,     // 30 minutes
    minRet:     0.15,               // 15% min return
    maxRet:     0.35,               // 35% max return
    lossChance: 0.62,               // 62% crash rate
    minLoss:    0.40,               // 40% min loss
    maxLoss:    0.70,               // 70% max loss
    minAmt:     5000,
  },
  long: {
    label:      "Long-Term",
    emoji:      "🏦",
    duration:   2 * 60 * 60 * 1000, // 2 hours
    minRet:     0.30,               // 30% min return
    maxRet:     0.80,               // 80% max return
    lossChance: 0.70,               // 70% crash rate
    minLoss:    0.60,               // 60% min loss
    maxLoss:    0.85,               // 85% max loss
    minAmt:     25000,
  },
};

function fmtMs(ms) {
  const hrs  = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (hrs > 0)  return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default {
  name: "invest",
  aliases: ["investment", "stock"],
  category: "economy",
  cooldown: 6,
  description: "Invest money in high-risk markets",
  usage: ".invest <amount> <short|medium|long>  |  .invest collect  |  .invest status",
  checkJail: true,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();
    const user  = await getUser(sender);

    const sub = (args[0] || "").toLowerCase();

    // ── STATUS ────────────────────────────────────────────────────────────
    if (sub === "status") {
      const inv = user.activeInvestment;
      if (!inv) return reply("📊 You have no active investment.\n\nUse *.invest <amount> <plan>* to start one.");

      const plan      = PLANS[inv.plan];
      const maturesAt = inv.startedAt + plan.duration;
      const matured   = now >= maturesAt;

      return reply(
`📊 *INVESTMENT STATUS*

${plan.emoji} Plan    : ${plan.label}
💰 Amount  : $${inv.amount.toLocaleString()}
📅 Started : ${new Date(inv.startedAt).toLocaleTimeString()}
⏰ Matures : ${matured ? "*NOW — Ready to collect!*" : `in ${fmtMs(maturesAt - now)}`}

${matured ? "✅ Use *.invest collect* to collect your returns!" : "⏳ Come back when the timer is up."}`
      );
    }

    // ── COLLECT ───────────────────────────────────────────────────────────
    if (sub === "collect") {
      const inv = user.activeInvestment;
      if (!inv) return reply("❌ You have no active investment to collect.");

      const plan      = PLANS[inv.plan];
      const maturesAt = inv.startedAt + plan.duration;

      if (now < maturesAt) {
        return reply(`⏳ Your investment hasn't matured yet!\n\nCome back in *${fmtMs(maturesAt - now)}*.`);
      }

      // Determine outcome
      const lost = Math.random() < (1 - economyWinRate(1 - plan.lossChance, user));
      let payout, net, lossPct;

      if (lost) {
        // Variable loss rate between minLoss and maxLoss
        lossPct = plan.minLoss + Math.random() * (plan.maxLoss - plan.minLoss);
        const lostAmt = Math.floor(inv.amount * lossPct);
        payout = Math.max(0, inv.amount - lostAmt);
        net    = -lostAmt;
      } else {
        const returnPct = plan.minRet + Math.random() * (plan.maxRet - plan.minRet);
        const profit    = Math.floor(inv.amount * returnPct);
        payout = inv.amount + profit;
        net    = profit;
      }

      const updatedUser = await collectInvestment(sender, inv, payout);
      if (!updatedUser) {
        return reply("⚠️ This investment was already collected or changed. Check `.invest status` for your current investment.");
      }
      await addHistory(sender, "invest", net, `Investment collected: ${inv.plan} plan`);

      return reply(
`${plan.emoji} *INVESTMENT COLLECTED!*

📌 Plan   : ${plan.label}
💰 Invested: $${inv.amount.toLocaleString()}
${lost
  ? `📉 *MARKET CRASH!* Lost ${(lossPct * 100).toFixed(1)}% — -$${Math.abs(net).toLocaleString()}`
  : `📈 *PROFIT!* +$${net.toLocaleString()} (${(net / inv.amount * 100).toFixed(1)}% return)`}

💰 Received : $${payout.toLocaleString()}
🏦 Balance  : $${updatedUser.money.toLocaleString()}`
      );
    }

    // ── NEW INVESTMENT ────────────────────────────────────────────────────
    if (!args[0] || !args[1] || !PLANS[args[1]?.toLowerCase()]) {
      return reply(
`🏦 *HIGH-RISK INVESTMENT*

High risk, volatile markets!

Plans:
  ⚡ *.invest <amt> short*  — 5 min  | +3–10% return  | 55% crash risk | $1k min
  📊 *.invest <amt> medium* — 30 min | +15–35% return | 62% crash risk | $5k min
  🏦 *.invest <amt> long*   — 2 hrs  | +30–80% return | 70% crash risk | $25k min

💡 Max investment: *$90,000,000* per investment
⚠️ *Warning:* Market crashes can wipe out up to 85% of your capital!

Collect with *.invest collect*.
_Only one active investment at a time._`
      );
    }

    if (user.activeInvestment) {
      const plan = PLANS[user.activeInvestment.plan];
      const maturesAt = user.activeInvestment.startedAt + plan.duration;
      return reply(`❌ You already have an active ${plan.label} investment!\n\nUse *.invest status* or collect it first with *.invest collect*.${now >= maturesAt ? "\n\n✅ It's ready to collect now!" : ""}`);
    }

    const planKey = args[1].toLowerCase();
    const plan    = PLANS[planKey];
    const rawAmt  = (args[0] || "").toLowerCase();

    let amount = rawAmt === "all" ? user.money : rawAmt === "half" ? Math.floor(user.money / 2) : parseInt(rawAmt.replace(/\D/g, ""), 10);

    if (!amount || isNaN(amount)) return reply("❌ Enter a valid amount. Example: *.invest 5000 medium*");
    if (amount < plan.minAmt)     return reply(`❌ Minimum investment for ${plan.label} is *$${plan.minAmt.toLocaleString()}*.`);
    if (amount > MAX_INVEST)      return reply(`❌ Maximum investment is *$90,000,000* per investment.`);
    if (amount > user.money)      return reply(`❌ You only have *$${user.money.toLocaleString()}*.`);

    const updatedUser = await startInvestment(sender, {
      plan: planKey,
      amount,
      startedAt: now,
    }, amount);
    if (!updatedUser) {
      return reply("⚠️ Your balance or active investment changed while starting this investment. Please try again.");
    }

    await addHistory(sender, "invest", -amount, `Started ${planKey} investment: $${amount.toLocaleString()}`);

    return reply(
`${plan.emoji} *INVESTMENT STARTED!*

📌 Plan    : ${plan.label}
💰 Amount  : $${amount.toLocaleString()}
⏰ Matures : in ${fmtMs(plan.duration)}
📈 Potential Return : ${(plan.minRet * 100).toFixed(0)}–${(plan.maxRet * 100).toFixed(0)}%
⚠️ Crash Risk       : ${(plan.lossChance * 100).toFixed(0)}%

Come back in *${fmtMs(plan.duration)}* and use *.invest collect*!
🏦 Remaining balance: $${updatedUser.money.toLocaleString()}`
    );
  },
};
