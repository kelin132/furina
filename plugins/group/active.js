import { groupSettings } from "../../lib/groupSettings.js";
import { findGroupParticipant, getGroupMetadata, participantIds, personalJid } from "../../lib/groupIdentity.mjs";

export function decodeActivityJid(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^jid_([A-Za-z0-9+/_=-]+)(?:@(?:lid|s\.whatsapp\.net|c\.us))?$/i);
  if (!match) return raw.startsWith("jid_") ? "" : raw;

  try {
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Buffer.from(encoded, "base64").toString("utf8").trim();
    return /^\+?\d+(?::\d+)?@(lid|s\.whatsapp\.net|c\.us)$/i.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

export function resolveActiveChatters(rows, metadata) {
  const byParticipant = new Map();

  for (const [storedJid, count] of rows) {
    const decoded = personalJid(decodeActivityJid(storedJid));
    const participant = decoded ? findGroupParticipant(metadata, [decoded]) : null;
    if (Array.isArray(metadata?.participants) && !participant) continue;

    const phoneJid = [
      participant?.phoneNumber,
      participant?.pn,
      participant?.jid,
      participant?.id,
      participant?.lid,
    ].map(personalJid).find((id) => id.endsWith("@s.whatsapp.net"));
    const ids = participantIds(participant);
    const jid = phoneJid || (ids.includes(decoded) ? decoded : (ids[0] || decoded));
    if (!jid) continue;

    const name = String(participant?.notify || participant?.name || participant?.verifiedName || "").trim();
    const tag = jid ? jid.split("@")[0].split(":")[0] : "";
    const previous = byParticipant.get(jid);
    byParticipant.set(jid, {
      jid,
      count: (previous?.count || 0) + (Number(count) || 0),
      name: previous?.name || name,
      tag,
    });
  }

  return [...byParticipant.values()]
    .map(({ jid, count, name, tag }) => ({
      jid,
      count,
      label: tag ? `@${tag}${name && name !== tag ? ` (${name})` : ""}` : (name || "Unknown member"),
    }))
    .sort((a, b) => b.count - a.count);
}

export default {
  name: "active",
  aliases: ["topchatters", "chatters"],
  description: "Rank recorded group chat activity",
  category: "group",
  usage: ".active",
  cooldown: 10,
  isAdmin: true,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;
    if (!jid?.endsWith("@g.us")) {
      return sock.sendMessage(jid, { text: "👥 This command can only be used in groups." }, { quoted: msg });
    }

    const counts = await groupSettings.getActivityCounts(jid);
    const rows = Object.entries(counts);

    if (!rows.length) {
      return sock.sendMessage(jid, {
        text: "📈 No group activity samples have been recorded yet. Use the bot normally and check again later.",
      }, { quoted: msg });
    }

    let metadata = null;
    try {
      metadata = await getGroupMetadata(sock, jid);
    } catch { /* Keep usable output if WhatsApp metadata is temporarily unavailable. */ }
    const chatters = resolveActiveChatters(rows, metadata).slice(0, 10);
    if (!chatters.length) {
      return sock.sendMessage(jid, {
        text: "📈 No current group members have activity records yet.",
      }, { quoted: msg });
    }
    const mentions = [...new Set(chatters.map((member) => member.jid).filter(Boolean))];
    const text = `🏆 *Top chatters*\n\n${chatters
      .map((member, index) => `${index + 1}. ${member.label} — ${member.count} messages`)
      .join("\n")}`;

    return sock.sendMessage(jid, { text, mentions }, { quoted: msg });
  },
};
