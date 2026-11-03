import { log } from "./logger.mjs";

export const CHANNEL_ANNOUNCEMENT_CHANNEL_INVITE = "0029Vb7yCnBC6ZvdA8NvrQ1q";
export const CHANNEL_ANNOUNCEMENT_COMMUNITY_INVITE = "CfU4bt6JL0iGhXgjZfS9qt";

const MAX_SEEN_MESSAGES = 5000;
const RELAY_REACTIONS = ["✨", "🔥", "💜", "🌸", "⚡", "🎉", "👀", "💎"];
const seenMessageIds = new Set();
let relayState = null;

function messageTimestampSeconds(message) {
  const value = message?.messageTimestamp;
  const timestamp = Number(value?.toString?.() ?? value ?? 0);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

async function resolveDestination(sock, inviteCode) {
  const group = await sock.groupGetInviteInfo(inviteCode);
  if (!group?.id) throw new Error("The community invite did not resolve to a WhatsApp group.");
  if (group.isCommunity && !group.isCommunityAnnounce) {
    const participating = await sock.groupFetchAllParticipating?.();
    const announcementGroup = Object.values(participating || {}).find(
      (candidate) => candidate.isCommunityAnnounce && candidate.linkedParent === group.id,
    );
    if (!announcementGroup?.id) {
      throw new Error(
        "The bot is not in the destination community yet; add it to the community before forwarding can start.",
      );
    }
    return announcementGroup.id;
  }
  return group.id;
}

function rememberMessage(id) {
  if (seenMessageIds.has(id)) return false;
  seenMessageIds.add(id);
  while (seenMessageIds.size > MAX_SEEN_MESSAGES) {
    seenMessageIds.delete(seenMessageIds.values().next().value);
  }
  return true;
}

async function forwardMessage(state, message) {
  const messageId = String(message?.key?.id || "");
  if (!messageId || !message?.message) return;
  const timestamp = messageTimestampSeconds(message);
  if (timestamp > 0 && timestamp < state.startedAtSeconds) return;
  const dedupeKey = `${state.channelJid}\0${messageId}`;
  if (!rememberMessage(dedupeKey)) return;

  for (let attempt = 0; attempt < 3; attempt++) {
    if (relayState !== state) return;
    try {
      const { generateForwardMessageContent } = await import("@whiskeysockets/baileys");
      const forwardedContent = generateForwardMessageContent(message, true);
      const contentKey = Object.keys(forwardedContent).find((key) => key !== "senderKeyDistributionMessage");
      if (!contentKey || !forwardedContent[contentKey]) {
        throw new Error("The channel announcement has no forwardable message content.");
      }

      const forwardedMessage = forwardedContent[contentKey];
      const contextInfo = forwardedMessage.contextInfo || {};
      const serverMessageId = Number(message?.key?.id);
      forwardedMessage.contextInfo = {
        forwardingScore: Math.max(1, Number(contextInfo.forwardingScore) || 0),
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: state.channelJid,
          newsletterName: state.channelName,
          ...(Number.isSafeInteger(serverMessageId) && serverMessageId > 0
            ? { serverMessageId }
            : {}),
          contentType: 1,
        },
      };

      // Relay the native forwarded message with WhatsApp's newsletter source
      // metadata in its ContextInfo. This keeps the source channel embedded in
      // the forwarded announcement instead of sending a second quoted link.
      const relayResult = await state.sock.relayMessage(state.destinationJid, forwardedContent, {});
      const forwardedId = typeof relayResult === "string"
        ? relayResult
        : String(relayResult?.key?.id || relayResult?.id || "");
      if (forwardedId) {
        const reaction = RELAY_REACTIONS[Math.floor(Math.random() * RELAY_REACTIONS.length)];
        await state.sock.sendMessage(state.destinationJid, {
          react: {
            text: reaction,
            key: { remoteJid: state.destinationJid, id: forwardedId, fromMe: true },
          },
        }).catch((error) => state.logger("warn", `[channelRelay] Could not react to forwarded announcement ${messageId}: ${error?.message || error}`));
      }
      state.logger("info", `[channelRelay] Forwarded announcement ${messageId} to destination group.`);
      return;
    } catch (error) {
      if (attempt === 2) {
        seenMessageIds.delete(dedupeKey);
        state.logger("warn", `[channelRelay] Could not forward announcement ${messageId}: ${error?.message || error}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 1000 : 3000));
    }
  }
}

export async function startChannelAnnouncementRelay(sock, {
  channelInviteCode = CHANNEL_ANNOUNCEMENT_CHANNEL_INVITE,
  communityInviteCode = CHANNEL_ANNOUNCEMENT_COMMUNITY_INVITE,
  logger = log,
} = {}) {
  if (!sock?.ev || !sock.newsletterMetadata || !sock.newsletterFollow || !sock.groupGetInviteInfo || !sock.relayMessage) {
    logger("warn", "[channelRelay] Required Baileys channel/group APIs are unavailable.");
    return false;
  }
  if (relayState?.sock === sock) return relayState.startPromise;
  stopChannelAnnouncementRelay();

  const state = {
    sock,
    logger,
    startedAtSeconds: Math.floor(Date.now() / 1000),
    channelJid: "",
    channelName: "WhatsApp Channel",
    destinationJid: "",
    handler: null,
    tail: Promise.resolve(),
    startPromise: null,
  };
  relayState = state;
  state.startPromise = (async () => {
    try {
      const [channel, destinationJid] = await Promise.all([
        sock.newsletterMetadata("invite", channelInviteCode),
        resolveDestination(sock, communityInviteCode),
      ]);
      if (relayState !== state) return false;
      if (!channel?.id) throw new Error("The channel invite did not resolve to a WhatsApp newsletter.");

      state.channelJid = channel.id;
      state.channelName = String(channel.name || channel.subject || "WhatsApp Channel");
      state.destinationJid = destinationJid;
      state.handler = ({ messages = [] } = {}) => {
        for (const message of messages) {
          if (message?.key?.remoteJid !== state.channelJid) continue;
          state.tail = state.tail
            .then(() => forwardMessage(state, message))
            .catch((error) => state.logger("warn", `[channelRelay] Relay handler failed: ${error?.message || error}`));
        }
      };
      sock.ev.on("messages.upsert", state.handler);

      try {
        await sock.newsletterFollow(state.channelJid);
      } catch (error) {
        // Following an already-followed channel can be rejected by WhatsApp;
        // existing subscriptions still deliver their message events.
        logger("warn", `[channelRelay] Could not follow source channel: ${error?.message || error}`);
      }
      logger("info", `[channelRelay] Listening to ${state.channelJid} for destination ${state.destinationJid}.`);
      return true;
    } catch (error) {
      logger("warn", `[channelRelay] Could not start announcement forwarding: ${error?.message || error}`);
      stopChannelAnnouncementRelay(sock);
      return false;
    }
  })();
  return state.startPromise;
}

export function stopChannelAnnouncementRelay(sock) {
  const current = relayState;
  if (!current || (sock && current.sock !== sock)) return;
  relayState = null;
  if (current.handler) current.sock.ev.off?.("messages.upsert", current.handler);
}
