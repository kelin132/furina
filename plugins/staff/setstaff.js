/**
 * .setstaff @user [level]
 * Set a user's staff level. Level: 1=mod, 2=staff, 3=admin
 * Owner can set any level. Staff can only set level 1 (mod).
 * Aliases: setmod, addstaff
 */
import { setStaffLevel } from "../economy/database.js";
import { findUserByIdentity, whatsappIdentityVariants } from "../../lib/identity.mjs";
import { invalidatePermissionCache } from "../../lib/permissions.mjs";

const LEVEL_NAMES = { 1: "Mod", 2: "Staff", 3: "Admin" };

function parseTarget(msg, args) {
  const context = msg.message?.extendedTextMessage?.contextInfo;
  const mentioned = context?.mentionedJidAlt?.[0] || context?.mentionedJid?.[0];
  if (mentioned) return String(mentioned);

  const discordMention = args
    .map((arg) => String(arg).match(/^<@!?(\d+)>$/))
    .find(Boolean);
  if (discordMention) return `discord:${discordMention[1]}`;

  const hasLevel = args.length > 1 && /^[1-3]$/.test(String(args.at(-1)));
  const targetArgs = hasLevel ? args.slice(0, -1) : args;
  const targetText = targetArgs.join("");
  if (!targetText || !/^[+\d\s().@-]+$/.test(targetText)) return null;
  const digits = targetText.replace(/\D/g, "");
  return digits.length >= 5 ? `${digits}@s.whatsapp.net` : null;
}

function invalidateIdentityCache(user) {
  const values = [
    user._id,
    user.phoneNumber,
    user.whatsappNumber,
    user.jid,
    user.userId,
    user.whatsappId,
    user.userJid,
  ].filter((value) => value !== undefined && value !== null).flatMap((value) =>
    whatsappIdentityVariants(String(value)),
  );
  for (const value of new Set(values)) invalidatePermissionCache(value);
}

export default {
  name: "setstaff",
  description: "Grant a user mod/staff/admin rank",
  category: "staff",
  usage: ".setstaff @user [1|2|3]",
  aliases: ["setmod", "addstaff", "grantstaff"],
  isMod: true,

  async run({ sock, msg, args, sender, isOwner, isActualOwner, isStaff, staffLevel }) {
    const jid = msg.key.remoteJid;
    const targetJid = parseTarget(msg, args);
    const context = msg.message?.extendedTextMessage?.contextInfo;
    const hasMention = Boolean(context?.mentionedJid?.length || context?.mentionedJidAlt?.length)
      || args.some((arg) => /^<@!?\d+>$/.test(String(arg)));
    const hasLevel = /^[1-3]$/.test(String(args.at(-1)))
      && (args.length > 1 || hasMention);
    const requestedLevel = hasLevel ? Number(args.at(-1)) : 1;

    if (!targetJid) {
      return sock.sendMessage(jid, {
        text:
          `❓ *Usage:* \`.setstaff @user [level]\`\n\n` +
          `*Levels:*\n` +
          `• \`1\` — Mod (can use staff commands)\n` +
          `• \`2\` — Staff (higher access)\n` +
          `• \`3\` — Admin (owner-level staff)\n\n` +
          `_Example: \`.setstaff @user 2\`_`
      }, { quoted: msg });
    }

    if (![1, 2, 3].includes(requestedLevel)) {
      return sock.sendMessage(jid, { text: "❌ Level must be 1 (Mod), 2 (Staff), or 3 (Admin)." }, { quoted: msg });
    }

    if (!isActualOwner && requestedLevel >= 3) {
      return sock.sendMessage(jid, { text: "❌ Only the owner can grant Admin rank." }, { quoted: msg });
    }
    if (!isOwner && Number(staffLevel || 0) < 2) {
      return sock.sendMessage(jid, {
        text: "❌ Only Staff or the owner can grant a staff rank."
      }, { quoted: msg });
    }
    if (!isOwner && requestedLevel >= Number(staffLevel || 0)) {
      return sock.sendMessage(jid, {
        text: `❌ You can only grant ranks below your own level (${LEVEL_NAMES[staffLevel] || "Staff"}).`
      }, { quoted: msg });
    }

    const target = await findUserByIdentity(targetJid, {
      projection: {
        _id: 1, name: 1, registered: 1, phoneNumber: 1,
        whatsappNumber: 1, jid: 1, userId: 1, whatsappId: 1, userJid: 1,
      },
    });
    if (!target?.registered) {
      return sock.sendMessage(jid, { text: "❌ That player is not registered." }, { quoted: msg });
    }
    const actor = sender
      ? await findUserByIdentity(sender, { projection: { _id: 1 } })
      : null;
    if (actor && String(target._id) === String(actor._id)) {
      return sock.sendMessage(jid, { text: "❌ You can't change your own rank." }, { quoted: msg });
    }

    const updated = await setStaffLevel(String(target._id), requestedLevel);
    if (!updated) {
      return sock.sendMessage(jid, {
        text: "❌ The staff rank wasn't saved. The user's existing account was left unchanged; please try again."
      }, { quoted: msg });
    }
    invalidateIdentityCache(target);
    invalidatePermissionCache(targetJid);

    await sock.sendMessage(jid, {
      text:
        `✅ *Staff Rank Updated*\n\n` +
        `👤 Player : ${target.name}\n` +
        `🏅 Rank   : ${LEVEL_NAMES[requestedLevel]}\n` +
        `🔑 Level  : ${requestedLevel}`,
      mentions: [targetJid],
    }, { quoted: msg });
  }
};
