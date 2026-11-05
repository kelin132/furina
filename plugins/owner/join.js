/**
 * KELIN MD — .join
 * Staff level 2+ command to join a group via invite link.
 *
 * Settings pulled from settings.cjs (botName, ownerName).
 * No external lib needed — uses Baileys sock.groupGetInviteInfo +
 * sock.groupAcceptInvite directly, matching the rest of this codebase.
 */
import { createRequire } from "module";

const _require  = createRequire(import.meta.url);
const _settings = _require("../../settings.cjs");

const BOT_NAME   = _settings.botName   || "AKIRA MD";
const OWNER_NAME = _settings.botOwner  || "Kelin";
const PREFIX     = process.env.PREFIX || ".";

export default {
  name:        "join",
  category:    "owner",
  description: `Join a group via invite link — prefix: ${PREFIX}`,
  usage:       `${PREFIX}join <invite_link>`,
  cooldown:    5,
  isStaff: true,
  minStaffLevel: 2,

  async run({ sock, msg, args }) {
    const jid   = msg.key.remoteJid;
    const reply = (text) => sock.sendMessage(jid, { text }, { quoted: msg });

    // ── .join ────────────────────────────────────────────────────────────
    const inviteLink = args[0];
    if (!inviteLink) {
      return reply(
`❌ Please provide a WhatsApp group invite link.

*Usage:*
${PREFIX}join https://chat.whatsapp.com/XXXXXXXXXXXXXXXXXXXXXX`
      );
    }

    // Extract the invite code from any valid chat.whatsapp.com URL format
    const inviteRegex = /chat\.whatsapp\.com\/(?:invite\/)?([a-zA-Z0-9_-]{20,26})/;
    const match       = inviteLink.match(inviteRegex);
    const inviteCode  = match ? match[1] : null;

    if (!inviteCode) {
      return reply(
`❌ Invalid invite link format.

Make sure the link looks like:
https://chat.whatsapp.com/XXXXXXXXXXXXXXXXXXXXXX`
      );
    }

    // ── Step 1: preview the group before joining ─────────────────────────
    let groupInfo;
    try {
      groupInfo = await sock.groupGetInviteInfo(inviteCode);
    } catch (err) {
      console.error("[join.js] groupGetInviteInfo error:", err.message);
      if (err.message?.includes("410") || err.message?.includes("gone")) {
        return reply("❌ This invite link has *expired* or been reset.");
      }
      if (err.message?.includes("404")) {
        return reply("❌ Invite link not found — it may have been revoked.");
      }
      return reply(`❌ Could not fetch group info: ${err.message}`);
    }

    const groupName = groupInfo?.subject || "Unknown Group";
    const groupId   = groupInfo?.id;

    // ── Step 2: accept the invite ─────────────────────────────────────────
    let groupJid;
    try {
      groupJid = await sock.groupAcceptInvite(inviteCode);
      // Some Baileys versions return null; fall back to the previewed ID
      if (!groupJid && groupId) groupJid = groupId;
    } catch (err) {
      console.error("[join.js] groupAcceptInvite error:", err.message);

      if (err.message?.includes("406") || err.message?.includes("not-authorized")) {
        return reply("❌ Could not join: The bot may be *banned* from this group, or the invite is admin-only.");
      }
      if (err.message?.includes("410") || err.message?.includes("gone")) {
        return reply("❌ Could not join: This invite link has *expired* or been reset.");
      }
      if (err.message?.includes("409") || err.message?.includes("conflict")) {
        return reply("ℹ️ The bot is *already a member* of this group.");
      }
      if (err.message?.includes("429")) {
        return reply("❌ *Rate limited* — too many join attempts. Please wait a few minutes and try again.");
      }
      if (err.message?.includes("account_reachout_restricted")) {
        return reply(
          "❌ *WhatsApp has restricted this bot number from joining groups.*\n\n" +
          "This is a WhatsApp account-level ban — it cannot be fixed in the bot.\n\n" +
          "*What to do:*\n" +
          "• Wait 24–72 hours and try again\n" +
          "• Ask the group admin to *add the bot manually* instead of using an invite link\n" +
          "• If it persists, the bot number may need to be replaced"
        );
      }
      return reply(`❌ Could not join group: ${err.message || "Unknown error"}`);
    }

    // ── Step 3: confirm to the command sender ────────────────────────────
    await reply(
`✅ *Successfully joined!*

📌 Group: *${groupName}*
🆔 JID: \`${groupJid}\`

${BOT_NAME} is now in the group.`
    );

    // ── Step 4: send intro message in the new group ───────────────────────
    if (!groupJid) return; // safety — can't send without a valid JID

    const introText =
`Thank you for adding me into this group,type *${PREFIX}menu* to begin.`;

    try {
      await sock.sendMessage(groupJid, { text: introText });
    } catch (err) {
      // Intro message is best-effort — don't surface this as a command error
      console.error("[join.js] Post-join message failed:", err.message);
    }
  },
};
