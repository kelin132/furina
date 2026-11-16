import {
  isBotOnline,
  listRegisteredBots,
  markBotSessionDeleted,
} from "../../lib/botRegistry.mjs";
import { formatAidoruRoster } from "../../lib/rosterFormat.mjs";

export default {
  name: "bots",
  description: "Show paired bots and their online status",
  category: "main",
  usage: ".bots",
  aliases: ["botlist", "botstatus"],
  cooldown: 10,

  async run({ sock, msg, sender, isOwner }) {
    const jid = msg.key.remoteJid;

    const raw   = (
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text || ""
    ).trim();
    const parts = raw.split(/\s+/);

    // ── Owner sub-command: .bots delete <position-number> ────────────────────
    // e.g. ".bots delete 2"  →  removes the 2nd bot from the sorted list
    if (isOwner && parts[1]?.toLowerCase() === "delete" && parts[2]) {
      const pos = parseInt(parts[2], 10);
      if (isNaN(pos) || pos < 1) {
        return sock.sendMessage(jid, {
          text: "❌ Give a valid bot number, e.g. *.bots delete 2*",
        }, { quoted: msg });
      }

      let bots;
      try {
        bots = await listRegisteredBots();
      } catch {
        return sock.sendMessage(jid, {
          text: "❌ Couldn't read the bot registry.",
        }, { quoted: msg });
      }

      if (pos > bots.length) {
        return sock.sendMessage(jid, {
          text: `❌ No bot #${pos}. Only *${bots.length}* bot(s) in the list.`,
        }, { quoted: msg });
      }

      const target = bots[pos - 1]; // list is 1-indexed for the user
      await markBotSessionDeleted(target._id || target.number);
      const name = target.botName || `Bot #${pos}`;
      return sock.sendMessage(jid, {
        text: `✅ *${name}* has been removed from the bot list.`,
      }, { quoted: msg });
    }

    // ── Normal list view ──────────────────────────────────────────────────────
    let bots;
    try {
      bots = await listRegisteredBots();
    } catch {
      return sock.sendMessage(jid, {
        text: "❌ I couldn't read the bot registry right now.",
      }, { quoted: msg });
    }

    const now        = Date.now();
    const rows = bots.length
      ? bots.map((bot) => {
          const online = isBotOnline(bot, now);
          const name   = bot.botName || "Unnamed Bot";
          const status = online ? "🟢" : "🔴";
          const platform = String(bot.platform || "WhatsApp");
          return `${status} *${name}* · ${platform}`;
        })
      : ["No paired bots registered yet."];

    const deleteHint = isOwner && bots.length
      ? `\n_Owner: .bots delete <number> to hide a bot_`
      : "";

    const text = `${formatAidoruRoster("BOTS", [{ rows }])}${deleteHint}`;

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
