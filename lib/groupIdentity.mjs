// Transport identities are not database account IDs. Keep their domains.
const groupMetadataInFlight = new WeakMap();

export function getGroupMetadata(sock, chatId) {
  if (!sock || !chatId || typeof sock.groupMetadata !== "function") {
    return Promise.reject(new Error("Group metadata is unavailable"));
  }
  let pendingByChat = groupMetadataInFlight.get(sock);
  if (!pendingByChat) {
    pendingByChat = new Map();
    groupMetadataInFlight.set(sock, pendingByChat);
  }
  if (pendingByChat.has(chatId)) return pendingByChat.get(chatId);
  const request = Promise.resolve().then(() => sock.groupMetadata(chatId))
    .finally(() => pendingByChat.delete(chatId));
  pendingByChat.set(chatId, request);
  return request;
}

export function personalJid(value) {
  const raw = String(value || "").trim();
  const separator = raw.indexOf("@");
  const local = separator >= 0 ? raw.slice(0, separator) : raw;
  const server = separator >= 0 ? raw.slice(separator) : "";
  const compact = local.replace(/[\s().-]/g, "") + server;
  const match = compact.match(/^\+?(\d+)(?::\d+)?(?:@(s\.whatsapp\.net|c\.us|lid))?$/i);
  if (!match) return "";
  return `${match[1]}@${match[2]?.toLowerCase() === "lid" ? "lid" : "s.whatsapp.net"}`;
}

export function participantIds(participant) {
  return [...new Set(["id", "jid", "lid", "phoneNumber"]
    .map(field => personalJid(participant?.[field])).filter(Boolean))];
}

export function participantIsAdmin(participant) {
  return [true, "admin", "superadmin"].includes(participant?.admin);
}

export function findGroupParticipant(metadata, identities) {
  const ids = new Set(identities.map(personalJid).filter(Boolean));
  return (metadata?.participants || []).find(p => participantIds(p).some(id => ids.has(id))) || null;
}

export async function resolveGroupParticipant(sock, metadata, identities) {
  const exact = findGroupParticipant(metadata, identities);
  if (exact) return exact;
  const ids = identities.map(personalJid).filter(Boolean);
  for (const id of [...ids]) {
    try {
      const mapping = sock.signalRepository?.lidMapping;
      const alternate = id.endsWith("@lid")
        ? await mapping?.getPNForLID?.(id)
        : await mapping?.getLIDForPN?.(id);
      if (personalJid(alternate)) ids.push(personalJid(alternate));
    } catch { /* Try the next identity; never grant permissions on failure. */ }
  }
  return findGroupParticipant(metadata, ids);
}

export function participantActionJid(participant) {
  const ids = [
    participant?.phoneNumber,
    participant?.pn,
    participant?.jid,
    participant?.id,
    participant?.lid,
  ].map(personalJid).filter(Boolean);
  return ids.find((id) => id.endsWith("@s.whatsapp.net")) || ids[0] || "";
}

export async function resolveGroupActionJids(sock, groupJid, identities) {
  const metadata = await getGroupMetadata(sock, groupJid);
  const targets = [];

  for (const identity of identities) {
    const participant = await resolveGroupParticipant(sock, metadata, [identity]);
    if (!participant) throw new Error("Group participant could not be resolved.");
    const target = participantActionJid(participant);
    if (!target) throw new Error("Group participant has no usable WhatsApp identity.");
    targets.push(target);
  }

  return [...new Set(targets)];
}

export async function groupRoles(sock, metadata, sender, alternate = "") {
  const [member, bot] = await Promise.all([
    resolveGroupParticipant(sock, metadata, [sender, alternate]),
    resolveGroupParticipant(sock, metadata, [sock.user?.id, sock.user?.jid, sock.user?.lid]),
  ]);
  return { member, bot, senderIsAdmin: participantIsAdmin(member), botIsAdmin: participantIsAdmin(bot),
    isSelf: !!member && member === bot };
}
