/**
 * .removestaff <list number | name | phone | @user>
 * Remove a user's staff/mod rank (set level back to 0).
 */
import { getStaffMembers, removeStaffLevel } from "../economy/database.js";
import {
  bareNumber,
  resolveStaffNumberMap,
  storedRealNumber,
} from "../../lib/staffNumbers.mjs";

function cleanName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export default {
  name: "removestaff",
  description: "Remove a user's staff/mod rank",
  category: "staff",
  usage: ".removestaff <list number | name | phone | @user>",
  aliases: ["demod", "destaff", "unmod"],
  isStaff: true,

  async run({ sock, msg, args, sender, isOwner, staffLevel }) {
    const jid = msg.key.remoteJid;
    const context = msg.message?.extendedTextMessage?.contextInfo;
    const identity = context?.mentionedJid?.[0] || context?.participant || "";
    const selector = Array.isArray(args) ? args.join(" ").trim() : String(args || "").trim();
    const usage = "❓ *Usage:* `.removestaff <list number | name | phone | @user>`";
    const staff = await getStaffMembers();

    if (!staff.length) {
      return sock.sendMessage(jid, { text: "📋 There are no staff members to remove." }, { quoted: msg });
    }

    staff.sort((a, b) =>
      (b.staffLevel || 0) - (a.staffLevel || 0) ||
      String(a.name || "").localeCompare(String(b.name || "")),
    );
    const numberMap = await resolveStaffNumberMap(sock, staff, jid);
    const phoneFor = (member) => {
      const source = bareNumber(member._id || member.jid || member.userId);
      return numberMap.get(source) || storedRealNumber(member) || source;
    };
    const identityNumber = bareNumber(identity);
    let matches = [];

    if (identityNumber) {
      matches = staff.filter((member) => {
        const source = bareNumber(member._id || member.jid || member.userId);
        return source === identityNumber || phoneFor(member) === (numberMap.get(identityNumber) || identityNumber);
      });
    } else if (/^\d{1,3}$/.test(selector) && Number(selector) >= 1 && Number(selector) <= staff.length) {
      matches = [staff[Number(selector) - 1]];
    } else {
      const digits = bareNumber(selector);
      if (/^\d{7,16}$/.test(digits)) {
        const resolved = numberMap.get(digits) || digits;
        matches = staff.filter((member) => phoneFor(member) === resolved);
      } else if (selector) {
        const wantedName = cleanName(selector);
        matches = staff.filter((member) => cleanName(member.name) === wantedName);
      }
    }

    if (!matches.length) {
      return sock.sendMessage(jid, {
        text: selector || identity ? "❌ No matching staff member found. Check `.staffs` and use its number, exact name, or phone." : usage,
      }, { quoted: msg });
    }
    if (matches.length > 1) {
      return sock.sendMessage(jid, {
        text: "❌ More than one staff member matches. Use their phone number or list number from `.staffs`.",
      }, { quoted: msg });
    }

    const target = matches[0];
    const targetJid = String(target._id || target.jid || "");
    const targetPhone = phoneFor(target);

    const senderNumber = bareNumber(sender);
    const resolvedSender = numberMap.get(senderNumber) || senderNumber;
    if (
      targetJid === sender ||
      (identityNumber && identityNumber === senderNumber) ||
      (targetPhone && targetPhone === resolvedSender)
    ) {
      return sock.sendMessage(jid, { text: "❌ You can't remove your own rank." }, { quoted: msg });
    }

    // Staff cannot remove someone of equal or higher rank
    if (!isOwner && (target.staffLevel || 0) >= staffLevel) {
      return sock.sendMessage(jid, {
        text: "❌ You cannot remove the rank of someone at or above your level."
      }, { quoted: msg });
    }

    const removed = await removeStaffLevel(targetJid);
    if (!removed) {
      return sock.sendMessage(jid, { text: "❌ The staff rank could not be removed. Please retry." }, { quoted: msg });
    }

    const displayName = String(target.name || "").trim();
    const phoneName = bareNumber(displayName) === bareNumber(targetPhone);
    const label = displayName && !phoneName ? displayName : `+${targetPhone}`;

    await sock.sendMessage(jid, {
      text:
        `✅ *Staff Rank Removed*\n\n` +
        `👤 Player : ${label}\n` +
        `📛 Rank   : Removed (now regular user)`,
      mentions: targetJid ? [targetJid] : [],
    }, { quoted: msg });
  }
};
