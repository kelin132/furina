/**
 * .staffs
 * List all staff members and their ranks.
 */
import { getStaffMembers } from "../economy/database.js";
import {
  bareNumber,
  resolveStaffNumberMap,
  storedRealNumber,
} from "../../lib/staffNumbers.mjs";

const LEVEL_NAMES = { 1: "🔧 Mod", 2: "🛡️ Staff", 3: "👑 Owner", 99: "👑 Owner" };

function displayName(name, number) {
  const value = String(name || "").trim();
  if (!value) return "";
  const digits = bareNumber(value);
  return digits && digits === bareNumber(number) ? "" : value;
}

export default {
  name: "staffs",
  description: "List all staff members",
  category: "staff",
  usage: ".staffs",
  aliases: ["stafflist", "staffmembers"],

  async run({ sock, msg }) {
    const jid    = msg.key.remoteJid;
    const list   = await getStaffMembers();

    if (list.length === 0) {
      return sock.sendMessage(jid, {
        text: "📋 *Staff List*\n\nNo staff members found."
      }, { quoted: msg });
    }

    list.sort((a, b) =>
      (b.staffLevel || 0) - (a.staffLevel || 0) ||
      String(a.name || "").localeCompare(String(b.name || "")),
    );
    const numberMap = await resolveStaffNumberMap(sock, list, jid);

    const rows = list.map((u, i) => {
      const rank = LEVEL_NAMES[u.staffLevel] || "Unknown";
      const sourceNumber = bareNumber(u._id || u.jid || u.userId);
      const num = numberMap.get(sourceNumber) || storedRealNumber(u) || sourceNumber || "?";
      const name = displayName(u.name, num);
      return [
        `╭─❖ *${i + 1}. ${name || `+${num}`}*`,
        ...(name ? [`│ 📱 Number: +${num}`] : []),
        `│ ${rank}`,
        "╰──────────────",
      ].join("\n");
    });

    await sock.sendMessage(jid, {
      text:
        `╭━━━〔 🛡️ *STAFF MEMBERS* 〕━━━╮\n` +
        `│ 👥 Members: *${list.length}*\n` +
        `╰━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
        rows.join("\n\n")
    }, { quoted: msg });
  }
};
