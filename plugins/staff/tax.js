import {
  collectTaxNow,
  getTaxAutomationStatus,
  setTaxAutomationEnabled,
} from "../../lib/taxScheduler.mjs";
import { TAX_INTERVAL_MS } from "../../lib/taxRules.mjs";

function formatAmount(value) {
  const amount = Number(value) || 0;
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount).toLocaleString()}`;
}

function formatStatus(status) {
  const lines = [
    "╭─🏛️「 *TAX COLLECTION CONTROL* 」─╮",
    `│ Automatic collection: *${status.enabled ? "ON" : "OFF"}*`,
    `│ 20% rate: *$300M+ wealth or top 2 on leaderboard*`,
  ];

  if (status.enabled && status.nextRunAt) {
    const remaining = Math.max(0, status.nextRunAt - Date.now());
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    lines.push(`│ Next automatic collection: in about *${hours}h*`);
  } else {
    lines.push("│ No automatic tax collection is scheduled.");
  }

  if (status.lastRun) {
    lines.push(`│ Last collection: ${new Date(status.lastRun).toISOString()}`);
  }

  lines.push(
    "│",
    "│ *.tax on* — enable, first run after 48 hours",
    "│ *.tax off* — stop automatic collections",
    "│ *.tax collect* — collect tax now",
    "│ *.tax status* — show this status",
    "╰─────────────────────────────❀",
  );
  return lines.join("\n");
}

export default {
  name: "tax",
  aliases: ["taxcontrol"],
  description: "View, toggle, or manually run progressive tax collection",
  category: "staff",
  usage: ".tax <status|on|off|collect>",
  isMod: true,
  cooldown: 5,

  async run({ sock, msg, args, isOwner, staffLevel }) {
    const jid = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    if (!isOwner && Number(staffLevel || 0) < 3) {
      return reply("❌ Only the bot owner or an admin with staff level 3 can control tax collection.");
    }

    const action = String(args[0] || "status").trim().toLowerCase();

    try {
      if (action === "status") {
        return reply(formatStatus(await getTaxAutomationStatus()));
      }

      if (action === "on") {
        const status = await setTaxAutomationEnabled(true);
        return reply(
          `✅ Automatic tax collection is *ON*. Collections repeat every ${TAX_INTERVAL_MS / (60 * 60 * 1000)} hours.\n\n${formatStatus(status)}`,
        );
      }

      if (action === "off") {
        const status = await setTaxAutomationEnabled(false);
        return reply(`✅ Automatic tax collection is *OFF*. No further scheduled collections will run.\n\n${formatStatus(status)}`);
      }

      if (action === "collect") {
        const result = await collectTaxNow();
        if (result.busy) {
          return reply("⏳ A tax collection is already running. Check *.tax status* and try again later.");
        }
        if (!result.ok) {
          return reply("❌ Tax collection failed. Check the bot logs for details.");
        }

        return reply(
          [
            "✅ *Tax collected*",
            `• Registered users: ${result.modifiedCount}/${result.count}`,
            `• Wallet tax: ${formatAmount(result.taxedMoney)}`,
            `• Bank tax: ${formatAmount(result.taxedBank)}`,
            `• Users taxed at 20% (including top 2): ${result.highWealthCount}`,
          ].join("\n"),
        );
      }

      return reply("❌ Usage: *.tax <status|on|off|collect>*");
    } catch (error) {
      console.error("[tax] Command failed:", error);
      return reply("❌ Tax settings could not be loaded. Check the bot database connection and logs.");
    }
  },
};
