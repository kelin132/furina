import { downloadContentFromMessage } from "@whiskeysockets/baileys";

const MESSAGE_WRAPPERS = [
  "ephemeralMessage",
  "viewOnceMessage",
  "viewOnceMessageV2",
  "viewOnceMessageV2Extension",
];

const MEDIA_TYPES = ["image", "video", "audio", "sticker", "document"];

export function unwrapMessage(message) {
  let current = message;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    const wrapper = MESSAGE_WRAPPERS
      .map((key) => current[key])
      .find((value) => value?.message);
    if (!wrapper) break;
    current = wrapper.message;
  }
  return current;
}

function messageContext(message) {
  const current = unwrapMessage(message);
  for (const type of [
    "extendedTextMessage",
    "imageMessage",
    "videoMessage",
    "audioMessage",
    "stickerMessage",
    "documentMessage",
    "buttonsResponseMessage",
    "listResponseMessage",
  ]) {
    if (current?.[type]?.contextInfo) return current[type].contextInfo;
  }
  return null;
}

export function getQuotedContext(msg) {
  const context = messageContext(msg?.message);
  const quoted = unwrapMessage(context?.quotedMessage);
  if (!context || !quoted) return null;
  return { context, message: quoted };
}

export function findQuotedMedia(msg, expectedType) {
  const quoted = getQuotedContext(msg);
  if (!quoted) {
    const error = new Error("Reply to a message containing the requested media.");
    error.code = "NOQUOTE";
    throw error;
  }

  const types = expectedType ? [expectedType] : MEDIA_TYPES;
  for (const type of types) {
    const media = quoted.message[`${type}Message`];
    if (media) return { ...quoted, type, media };
  }

  const error = new Error(`The replied message does not contain ${expectedType || "supported"} media.`);
  error.code = "NOT_SUPPORTED_MEDIA";
  throw error;
}

export async function downloadQuotedMedia(msg, expectedType) {
  const quoted = findQuotedMedia(msg, expectedType);
  const announcedSize = Number(quoted.media.fileLength || 0);
  if (announcedSize > 64 * 1024 * 1024) {
    throw new Error("The replied media is too large (maximum 64 MB).");
  }

  const stream = await downloadContentFromMessage(quoted.media, quoted.type);
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.length;
    if (totalBytes > 64 * 1024 * 1024) {
      throw new Error("The replied media is too large (maximum 64 MB).");
    }
    chunks.push(chunk);
  }

  return {
    ...quoted,
    buffer: Buffer.concat(chunks),
    mimetype: quoted.media.mimetype || "",
  };
}
