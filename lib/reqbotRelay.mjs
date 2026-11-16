import { randomUUID } from "node:crypto";
import { findGroupParticipant, participantIsAdmin as hasAdminRole } from "./groupIdentity.mjs";

export const REQBOT_NOTIFY_INVITE_CODE = "DbLOOeHt2hf9NV8pvCfZAv";

const REQUEST_COLLECTION = "reqbot_requests";
const REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const REQUEST_CLAIM_MS = 60 * 1000;
const REQUEST_MAX_ATTEMPTS = 5;
const RELAY_POLL_MS = 5_000;
const RELAY_BATCH_SIZE = 5;
const activeRelays = new WeakMap();

/**
 * Only the account that is actually an admin in the request group may forward
 * queued requests there.
 */
export function isBotAdminInGroup(sock, metadata) {
  return hasAdminRole(findGroupParticipant(metadata, [sock?.user?.id, sock?.user?.jid, sock?.user?.lid]));
}

function oneLine(value, fallback = "Unknown") {
  return String(value || fallback).replace(/\s+/g, " ").trim() || fallback;
}

export function formatReqbotRequest(request) {
  const sender = oneLine(request?.sender);
  const requesterNumber = sender.split("@")[0].split(":")[0];
  const requesterName = oneLine(request?.requesterName, "");
  const groupLink = oneLine(request?.groupLink, "Missing invite link");
  const sourceChat = oneLine(request?.sourceChatJid, "Unknown chat");
  const sourceBot = oneLine(request?.sourceBotName, "KELIN MD");
  const createdAt = request?.createdAt instanceof Date
    ? request.createdAt
    : new Date(request?.createdAt || Date.now());

  return (
    `╭━━━〔 📩 BOT REQUEST 〕━━━╮\n\n` +
    `👤 *Requested by:*\n` +
    `${requesterName ? `• Name: ${requesterName}\n` : ""}` +
    (sender.startsWith("discord:")
      ? `• AIDORU account: ${sender}\n\n`
      : `• JID: ${sender}\n• Number: +${requesterNumber}\n\n`) +
    `📎 *Group link:*\n${groupLink}\n\n` +
    `🤖 *Submitted through:* ${sourceBot}\n` +
    `💬 *Source chat:* ${sourceChat}\n` +
    `🕒 *Time:* ${createdAt.toLocaleString()}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `Reply or use *.join <link>* to add a bot.\n` +
    `╰━━━━━━━━━━━━━━━━━━╯`
  );
}

async function getRequestCollection() {
  const { getDb } = await import("./mongo.mjs");
  return getDb().collection(REQUEST_COLLECTION);
}

async function getNotificationGroupId(sock, state) {
  if (state.notificationGroupId) return state.notificationGroupId;
  if (state.notificationGroupLookup) return state.notificationGroupLookup;

  state.notificationGroupLookup = (async () => {
    try {
      const info = await sock.groupGetInviteInfo(REQBOT_NOTIFY_INVITE_CODE);
      state.notificationGroupId = info?.id || null;
      return state.notificationGroupId;
    } finally {
      state.notificationGroupLookup = null;
    }
  })();

  try {
    return await state.notificationGroupLookup;
  } catch {
    return null;
  }
}

async function claimAndForward(sock, collection, request, groupJid, botJid) {
  const now = new Date();
  const claim = await collection.updateOne(
    {
      _id: request._id,
      $or: [
        { status: "pending" },
        { status: "sending", leaseUntil: { $lt: now } },
      ],
    },
    {
      $set: {
        status: "sending",
        handlerBotJid: botJid,
        leaseUntil: new Date(now.getTime() + REQUEST_CLAIM_MS),
        updatedAt: now,
      },
      $inc: { attempts: 1 },
    },
  );
  if (claim.modifiedCount !== 1) return;

  try {
    await sock.sendMessage(groupJid, { text: formatReqbotRequest(request) });
    await collection.updateOne(
      { _id: request._id, status: "sending", handlerBotJid: botJid },
      {
        $set: { status: "sent", sentAt: new Date(), updatedAt: new Date() },
        $unset: { leaseUntil: "" },
      },
    );
  } catch (error) {
    const attempts = Number(request.attempts || 0) + 1;
    const nextStatus = attempts >= REQUEST_MAX_ATTEMPTS ? "failed" : "pending";
    await collection.updateOne(
      { _id: request._id, status: "sending", handlerBotJid: botJid },
      {
        $set: {
          status: nextStatus,
          lastError: String(error?.message || error).slice(0, 300),
          updatedAt: new Date(),
        },
        $unset: { leaseUntil: "" },
      },
    );
    console.error(`[reqbot] Could not forward request ${request._id}:`, error?.message || error);
  }
}

async function pollReqbotQueue(sock, state) {
  if (state.stopped || state.busy) return;
  state.busy = true;

  try {
    const collection = await getRequestCollection();
    const now = new Date();
    const oldestAllowed = new Date(now.getTime() - REQUEST_MAX_AGE_MS);
    const requests = await collection.find({
      createdAt: { $gte: oldestAllowed },
      attempts: { $lt: REQUEST_MAX_ATTEMPTS },
      $or: [
        { status: "pending" },
        { status: "sending", leaseUntil: { $lt: now } },
      ],
    }).sort({ createdAt: 1 }).limit(RELAY_BATCH_SIZE).toArray();
    if (!requests.length) return;

    const groupJid = await getNotificationGroupId(sock, state);
    if (!groupJid) return;

    const metadata = await sock.groupMetadata(groupJid);
    if (!isBotAdminInGroup(sock, metadata)) return;

    const botJid = sock.user?.id || sock.user?.jid || "";
    for (const request of requests) {
      if (state.stopped) break;
      await claimAndForward(sock, collection, request, groupJid, botJid);
    }
  } catch (error) {
    if (Date.now() - state.lastErrorLogAt > 60_000) {
      console.warn("[reqbot] Relay check failed; it will retry:", error?.message || error);
      state.lastErrorLogAt = Date.now();
    }
  } finally {
    state.busy = false;
  }
}

export async function enqueueReqbotRequest({
  sender,
  groupLink,
  sourceChatJid,
  sourceBotName,
}) {
  const collection = await getRequestCollection();
  const now = new Date();
  await collection.updateMany(
    {
      status: { $in: ["pending", "sending"] },
      createdAt: { $lt: new Date(now.getTime() - REQUEST_MAX_AGE_MS) },
    },
    {
      $set: { status: "expired", updatedAt: now },
      $unset: { leaseUntil: "" },
    },
  );

  const request = {
    _id: randomUUID(),
    sender: String(sender || ""),
    groupLink: String(groupLink || ""),
    sourceChatJid: String(sourceChatJid || ""),
    sourceBotName: String(sourceBotName || "KELIN MD"),
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await collection.insertOne(request);
  return request._id;
}

export function startReqbotRelay(sock) {
  if (!sock || activeRelays.has(sock)) return;
  const state = {
    busy: false,
    stopped: false,
    notificationGroupId: null,
    notificationGroupLookup: null,
    lastErrorLogAt: 0,
    timer: null,
  };
  activeRelays.set(sock, state);

  void pollReqbotQueue(sock, state);
  state.timer = setInterval(() => void pollReqbotQueue(sock, state), RELAY_POLL_MS);
  state.timer.unref?.();
}

export function stopReqbotRelay(sock) {
  const state = activeRelays.get(sock);
  if (!state) return;
  state.stopped = true;
  clearInterval(state.timer);
  activeRelays.delete(sock);
}
