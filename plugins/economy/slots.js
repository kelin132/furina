/**
 * KELIN MD — .slots
 * Spin the slot machine — match symbols to win big!
 * Usage: .slots <amount>
 */
import { getUser, saveUser, requireRegistration, addHistory, maybeAwardDiamonds, checkLevelUp } from "./database.js";
import { randomChoice } from "../../lib/gambling.mjs";
import { parseAmount } from "./parseAmount.js";
import { MAX_BET, maxBetMessage } from "./bettingLimits.js";
import { getNewlyUnlockedRole, buildLevelUpMsg } from "../../lib/levelRoles.mjs";

const COOLDOWN = 15 * 1000;

const SYMBOL_POOL = [
  ...Array(6).fill("🍒"), ...Array(5).fill("🍋"), ...Array(5).fill("🍊"),
  ...Array(4).fill("🍇"), ...Array(3).fill("🔔"), ...Array(2).fill("💎"),
  ...Array(1).fill("7️⃣"), ...Array(2).fill("🃏"),
];
const PAYOUTS = { "7️⃣": 10, "💎": 7, "🔔": 5, "🍇": 4, "🍊": 3, "🍋": 2.5, "🍒": 2, "🃏": 1.5 };

function spin() { return [0, 0, 0].map(() => randomChoice(SYMBOL_POOL)); }

function fmt(n) {
  if (n >= 1e12) return `$${(n/1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n/1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

export default {
  name: "slots",
  aliases: ["slot", "slotmachine"],
  category: "economy",
  cooldown: 6,
  description: "Spin the slot machine — match 3 symbols to win!",
  usage: ".slots <amount>",
  checkJail: true,

  async run({ sock, msg, sender, args, discord }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid   = msg.key.remoteJid;
    const reply = (t) => sock.sendMessage(jid, { text: t }, { quoted: msg });
    const now   = Date.now();

    try {
      const user  = await getUser(sender);
      if (!user) {
        return reply("❌ Error loading user data. Please try again.");
      }

      // Safely check cooldown with proper null handling
      const lastSlots = user.lastSlots || 0;
      if (now - lastSlots < COOLDOWN) {
        const secs = Math.ceil((COOLDOWN - (now - lastSlots)) / 1000);
        return reply(
`╭─❀「 🎰 *𝐒𝐋𝐎𝐓𝐒* 」❀─╮
│ ⏳ *Result* :: *COOLDOWN 🔴*
│ 🕐 *Wait*   :: *${secs}s remaining*
╰───────────────❀`
        );
      }

      const raw = (args[0] || "").toLowerCase();
      if (!raw) {
        return reply(
`╭─❀「 🎰 *𝐒𝐋𝐎𝐓𝐒* 」❀─╮
│ 📖 *Usage*    :: *.slots <amount>*
│ 💰 *Min Bet*  :: *$50*
│ 💰 *Max Bet*  :: *$5M*
│
│ 💎 *Payouts* (match 3):
│   7️⃣ ×10  💎 ×7  🔔 ×5  🍇 ×4
│   🍊 ×3  🍋 ×2.5  🍒 ×2  🃏 ×1.5
│   Two matching → ×0.5 return (net −0.5 stake)
│
│ 💰 *Wallet*  :: *${fmt(user.money)}*
╰───────────────❀`
        );
      }

      let amount = parseAmount(raw, user.money);
      if (!amount || isNaN(amount) || amount < 50) return reply("❌ Minimum bet is *$50*.");
      if (amount > MAX_BET)  return reply(maxBetMessage());
      if (amount > user.money) return reply(`❌ You only have *${fmt(user.money)}*.`);

      // Update cooldown BEFORE spinning
      user.lastSlots = now;
      
      const reels    = spin();
      const [a, b, c] = reels;

      let winnings = 0, resultMsg = "", resultLine = "";

      if (a === b && b === c) {
        const mult = PAYOUTS[a] || 2;
        winnings   = Math.floor(amount * mult);
        resultMsg  = `JACKPOT! ×${mult}`;
        resultLine = `│ ✨ *JACKPOT!* Three ${a}s! おめでとう！🎉`;
      } else if (a === b || b === c || a === c) {
        winnings   = Math.floor(amount * 0.5);
        resultMsg  = "Partial return ×0.5";
        resultLine = `│ 🌸 *Partial Win!* Two matching 🎊`;
      } else {
        winnings   = 0;
        resultMsg  = "No Match";
        resultLine = `│ 💀 *Better luck next time!* 頑張れ！`;
      }

      const net = winnings - amount;
      user.money = Math.max(0, user.money + net);
      user.xp    = (user.xp || 0) + 5;
      
      // Improve diamond reward logic: award more for big wins
      const diamondReward = maybeAwardDiamonds(
        user, 
        winnings >= amount * 3 ? 0.01 : winnings >= amount * 2 ? 0.005 : 0.001, 
        1, 
        2
      );

      const { leveled, startLevel, newLevel } = checkLevelUp(user);
      
      // Save user with updated cooldown and stats
      await saveUser(sender, user);
      await addHistory(sender, "slots", net, `Slots: bet $${amount.toLocaleString()}`);

      const tag = user.name || sender.split("@")[0].split(":")[0];

      const won    = net > 0;
      const caption = [
        `┌ 🎰 SLOTS ─ ${won ? "WIN ✅" : "LOSE ❌"}`,
        `│ 🎲 Reels: ${a} ┃ ${b} ┃ ${c}`,
        `│ 🎯 Stake: ${fmt(amount)}`,
        `│ 💬 Result: ${resultMsg}`,
        `│ ${net >= 0 ? "💰 +" : "💸 -"}${fmt(Math.abs(net))} │ 💰 ${fmt(user.money)}`,
        ...(diamondReward ? [`│ 💎 Bonus: +${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}`] : []),
        "└─────────────────",
      ].join("\n");

      if (discord?.message) {
        await sock.sendMessage(jid, {
          discordEmbed: {
            title: "🎰 Slot Machine",
            description: `[ ${a}  |  ${b}  |  ${c} ]`,
            color: won ? "#45D483" : "#FF5D73",
            fields: [
              { name: "Bet", value: fmt(amount), inline: true },
              {
                name: "Result",
                value: won
                  ? `🎉 ${resultMsg}\nPayout: ${fmt(winnings)}`
                  : winnings > 0
                  ? `🟡 ${resultMsg}\nPayout: ${fmt(winnings)}\nNet: -${fmt(Math.abs(net))}`
                  : "😢 You lost. Better luck next time!",
                inline: false,
              },
              { name: "Wallet", value: fmt(user.money), inline: true },
            ],
          },
        }, { quoted: msg });
      } else {
        await reply(caption);
      }

      if (leveled) {
        const newRole = getNewlyUnlockedRole(startLevel, newLevel);
        await sock.sendMessage(jid, { text: buildLevelUpMsg(tag, startLevel, newLevel, newRole) }, { quoted: msg });
      }
    } catch (error) {
      console.error("❌ Slots command error:", error);
      return reply("❌ An error occurred while spinning. Please try again.");
    }
  },
};
