/**
 * KELIN MD — Bot connection manager (standalone, panel-compatible)
 */
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  BufferJSON,
  proto,
} from "@whiskeysockets/baileys";
import path from "path";
import { existsSync, mkdirSync } from "fs";
import { readFile, stat, unlink, writeFile } from "fs/promises";
import { log } from "./logger.mjs";
import { routeMessage, getAfkUser, deleteAfkUser } from "./pluginManager.mjs";
import { shortRead } from "./shortReadCache.mjs";
import { ensureDb } from "./mongo.mjs";
import {
  BOT_HEARTBEAT_INTERVAL_MS,
  heartbeatBot,
  markBotOffline,
  markBotOnline,
} from "./botRegistry.mjs";
import { antiLinkHandler } from "../plugins/group/antilinkHandler.js";
import { antibadwordHandler } from "../plugins/group/antibadwordHandler.js";
import { antispamHandler } from "../plugins/group/antispamHandler.js";
import { antimentionHandler } from "../plugins/group/antimentionHandler.js";
import { mutedUserHandler } from "../plugins/group/mutedUserHandler.js";
import { akiraHandler } from "./akiraHandler.mjs";
import { handleTodText } from "./todGame.mjs";
import { handleAnimeQuizText } from "./animeQuizGame.mjs";
import { clearAfk, getAfkStatus, getUser, saveUser } from "../plugins/economy/database.js";
import { normalizeJid } from "./identity.mjs";
import { handleGroupParticipants } from "./groupEventHandler.mjs";
import { startReqbotRelay, stopReqbotRelay } from "./reqbotRelay.mjs";
import { recordGroupActivity } from "./groupSettings.js";
import {
  startWebAuctionAnnouncements,
  pauseWebAuctionAnnouncements,
} from "./webAuctionAnnouncements.mjs";
import { startLotteryAnnouncementRelay, stopLotteryAnnouncementRelay } from "./lotteryAnnouncementRelay.mjs";
import { startChannelAnnouncementRelay, stopChannelAnnouncementRelay } from "./channelAnnouncementRelay.mjs";
import { handleKordGameText } from "./kordGames.mjs";
import { createRequire } from "module";
import pino from "pino";
import { getRuntimeSettings } from "./runtimeSettings.mjs";
import { handleGiveawayReaction, restoreGiveaways } from "./giveawayManager.mjs";

const _require  = createRequire(import.meta.url);
const _settings = _require("../settings.cjs");

const SESSION_DIR = process.env.SESSION_DIR
  ? path.resolve(process.env.SESSION_DIR)
  : path.resolve("sessions", "auth");
const SESSION_CREDENTIAL_FILE = path.basename(process.env.SESSION_CREDENTIAL_FILE || "creds.json");
const INITIAL_RUNTIME_SETTINGS = getRuntimeSettings();
const BOT_NAME = INITIAL_RUNTIME_SETTINGS.botName || process.env.BOT_NAME || _settings.botName || "KELIN MD";

const silentLogger = pino({ level: "silent" });

let sock           = null;
let reconnectTimer = null;
let heartbeatTimer = null;
let registryUnavailableLogged = false;
const processStartedAt = new Date();
let _prefix        = INITIAL_RUNTIME_SETTINGS.prefix || ".";
let _phoneNumber   = null;
let manualRestart  = false;

// ── Queue & Concurrency Adjustments ──────────────────────────────────────────
const messageQueues = new Map();
const MAX_PENDING_MESSAGES_PER_KEY = 8;
const MAX_CONCURRENT_COMMANDS_PER_KEY = 4;

// Normalize phone JIDs and preserve privacy LIDs (e.g. 123:12@lid).
// The old helper converted LIDs into invalid "123@lid@s.whatsapp.net" values,
// which made persisted AFK records impossible to find when the next message
// arrived.
const cleanJid = (jid = "") => normalizeJid(jid);

export async function hasSession() {
  const credsPath = path.join(SESSION_DIR, SESSION_CREDENTIAL_FILE);
  if (!existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(await readFile(credsPath, "utf8"));
    return creds.registered === true;
  } catch {
    return false;
  }
}

export function getPrefix() { return getRuntimeSettings().prefix || _prefix; }
export function getSocket() { return sock; }

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function syncBotRegistry(jid, { online = false, startedAt = processStartedAt } = {}) {
  if (!jid) return false;
  try {
    await ensureDb();
    if (online) {
      await markBotOnline({ botJid: jid, botName: BOT_NAME, startedAt });
    } else {
      await heartbeatBot(jid);
    }
    registryUnavailableLogged = false;
    return true;
  } catch (error) {
    if (!registryUnavailableLogged) {
      log("warn", `Bot registry unavailable: ${error.message}. Updates will retry.`);
      registryUnavailableLogged = true;
    }
    return false;
  }
}

async function markBotOfflineSafely(jid) {
  if (!jid) return;
  try {
    await ensureDb();
    await markBotOffline(jid);
  } catch (error) {
    if (!registryUnavailableLogged) {
      log("warn", `Bot registry unavailable while marking offline: ${error.message}`);
      registryUnavailableLogged = true;
    }
  }
}

const authFileLocks = new Map();
async function withAuthFileLock(filePath, operation) {
  const previous = authFileLocks.get(filePath) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  authFileLocks.set(filePath, current);
  try {
    return await current;
  } finally {
    if (authFileLocks.get(filePath) === current) authFileLocks.delete(filePath);
  }
}

export async function useExistingMultiFileAuthState(folder, credentialFileName) {
  const folderInfo = await stat(folder).catch(() => null);
  if (!folderInfo?.isDirectory()) {
    throw new Error(`session folder does not exist: ${folder}`);
  }

  const fixFileName = (file) => file.replace(/\//g, "__").replace(/:/g, "-");
  const credentialPath = path.join(folder, credentialFileName);
  if (!existsSync(credentialPath)) {
    throw new Error(`credential file does not exist: ${credentialPath}`);
  }

  const readData = async (file) => {
    try {
      const filePath = path.join(folder, fixFileName(file));
      return await withAuthFileLock(filePath, async () =>
        JSON.parse(await readFile(filePath, "utf8"), BufferJSON.reviver)
      );
    } catch {
      return null;
    }
  };

  const writeData = async (data, file) => {
    const filePath = path.join(folder, fixFileName(file));
    return withAuthFileLock(filePath, () =>
      writeFile(filePath, JSON.stringify(data, BufferJSON.replacer))
    );
  };

  const removeData = async (file) => {
    try {
      const filePath = path.join(folder, fixFileName(file));
      return await withAuthFileLock(filePath, () => unlink(filePath).catch(() => {}));
    } catch {
      return undefined;
    }
  };

  const creds = await readData(credentialFileName);
  if (!creds) throw new Error(`cannot read ${credentialPath}`);

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let value = await readData(`${type}-${id}.json`);
            if (type === "app-state-sync-key" && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const file = `${category}-${id}.json`;
              tasks.push(value ? writeData(value, file) : removeData(file));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      if (!existsSync(credentialPath)) {
        throw new Error(`credential file was removed: ${credentialPath}`);
      }
      return writeData(creds, credentialFileName);
    },
  };
}

export function restartConnection() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (!sock) {
    reconnectTimer = setTimeout(() => connectBot(null, _prefix), 250);
    return;
  }

  manualRestart = true;
  try {
    sock.ws?.close();
  } catch (err) {
    log("warn", `Socket restart close failed: ${err.message}`);
    manualRestart = false;
    sock = null;
    reconnectTimer = setTimeout(() => connectBot(null, _prefix), 250);
  }
}

function cleanupMessageQueue(queueKey, queue) {
  if (
    queue.pending === 0 &&
    queue.commandActive === 0 &&
    queue.commandPending.length === 0 &&
    messageQueues.get(queueKey) === queue
  ) {
    messageQueues.delete(queueKey);
  }
}

function drainCommandQueue(queueKey, queue) {
  while (
    queue.commandActive < MAX_CONCURRENT_COMMANDS_PER_KEY &&
    queue.commandPending.length > 0
  ) {
    const next = queue.commandPending.shift();
    queue.commandActive += 1;

    Promise.resolve()
      .then(next)
      .catch((err) => {
        log("error", "Plugin error: " + String(err));
      })
      .finally(() => {
        queue.commandActive -= 1;
        cleanupMessageQueue(queueKey, queue);
        drainCommandQueue(queueKey, queue);
      })
      .catch(() => {});
  }
}

function queueIncomingMessage(msg, handler) {
  const remoteJid = msg.key?.remoteJid || "";
  const senderJid = cleanJid(msg.key?.participant || remoteJid);
  const queueKey = `${remoteJid}:${senderJid}`;
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";
  const isCommand = body.trimStart().startsWith(getPrefix());

  let queue = messageQueues.get(queueKey);
  if (!queue) {
    queue = {
      tail: Promise.resolve(),
      pending: 0,
      commandActive: 0,
      commandPending: [],
    };
    messageQueues.set(queueKey, queue);
  }

  const totalQueued = queue.pending + queue.commandActive + queue.commandPending.length;
  if (totalQueued >= MAX_PENDING_MESSAGES_PER_KEY) {
    if (isCommand) {
      void sock?.sendMessage(remoteJid, {
        text: "⏳ Processing previous requests. Please wait a moment.",
      }).catch(() => {});
    }
    return;
  }

  if (isCommand) {
    queue.commandPending.push(handler);
    drainCommandQueue(queueKey, queue);
    return;
  }

  queue.pending += 1;
  const current = queue.tail
    .catch(() => {})
    .then(handler)
    .catch((err) => {
      log("error", "Plugin error: " + String(err));
    });
  queue.tail = current;

  current.finally(() => {
    queue.pending -= 1;
    cleanupMessageQueue(queueKey, queue);
  }).catch(() => {});
}

export async function connectBot(phoneNumber, prefix) {
  _prefix = getRuntimeSettings().prefix || prefix || _prefix;
  if (phoneNumber) _phoneNumber = phoneNumber.replace(/\D/g, "");

  if (!existsSync(SESSION_DIR)) {
    if (process.env.BOT_ID) {
      throw new Error(`multi-bot session folder does not exist: ${SESSION_DIR}`);
    }
    mkdirSync(SESSION_DIR, { recursive: true });
  }

  log("info", "Connecting to WhatsApp...");

  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    log("info", `Baileys version: ${version.join(".")} ${isLatest ? "(latest)" : ""}`);

    const { state: authState, saveCreds } =
      process.env.BOT_ID
        ? await useExistingMultiFileAuthState(SESSION_DIR, SESSION_CREDENTIAL_FILE)
        : await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      version,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, silentLogger),
      },
      printQRInTerminal: false,
      browser: ["Ubuntu", "Chrome", "20.0.04"],
      connectTimeoutMs: 60_000,
      retryRequestDelayMs: 2_000,
      logger: silentLogger,
    });

    const sendMessage = sock.sendMessage.bind(sock);
    sock.sendMessage = (jid, content, options) => {
      if (content && typeof content === "object" && !("linkPreview" in content)) {
        content = { linkPreview: false, ...content };
      }
      return sendMessage(jid, content, options);
    };

    sock.ev.on("creds.update", saveCreds);

    if (!authState.creds.registered && _phoneNumber) {
      await delay(3_000);
      try {
        log("info", `Requesting pairing code for +${_phoneNumber} ...`);
        const code = await sock.requestPairingCode(_phoneNumber);
        showPairingCode(code, _phoneNumber);
      } catch (err) {
        log("error", "Pairing code request failed: " + String(err));
      }
    }

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === "open") {
        const jid = sock.user?.id ?? "";
        const num = jid.split(":")[0].replace("@s.whatsapp.net", "");
        log("info", `✅ Connected as +${num}`);

        await restoreGiveaways(sock);
        if (process.env.BOT_WEB_AUCTION_ANNOUNCEMENTS !== "false") {
          startWebAuctionAnnouncements(sock);
        }
        startLotteryAnnouncementRelay(sock);
        startReqbotRelay(sock);
        if (!process.env.BOT_ID || process.env.BOT_CHANNEL_ANNOUNCEMENT_RELAY === "true") {
          void startChannelAnnouncementRelay(sock);
        }

        if (heartbeatTimer) clearInterval(heartbeatTimer);
        await syncBotRegistry(jid, { online: true });
        heartbeatTimer = setInterval(() => {
          void syncBotRegistry(jid);
        }, BOT_HEARTBEAT_INTERVAL_MS);
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const loggedOut  = statusCode === DisconnectReason.loggedOut;
        const sessionReplaced = statusCode === 440;

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        pauseWebAuctionAnnouncements(sock);
        stopLotteryAnnouncementRelay();
        stopChannelAnnouncementRelay(sock);
        stopReqbotRelay(sock);
        await markBotOfflineSafely(sock.user?.id);
        sock = null;

        if (sessionReplaced) {
          log("error", "WhatsApp session replaced (440).");
          process.exit(process.env.BOT_ID ? 42 : 1);
        } else if (!loggedOut) {
          const wait = manualRestart ? 1_000 : 5_000;
          manualRestart = false;
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => connectBot(null, _prefix), wait);
        } else {
          process.exit(0);
        }
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      if (type !== "notify") return;

      for (const msg of messages) {
        if (msg.key?.remoteJid?.endsWith("@newsletter")) continue;
        if (!msg.message) continue;
        const senderJid = cleanJid(msg.key.participant || msg.key.remoteJid || "");

        if (msg.key.remoteJid?.endsWith("@g.us") && senderJid && !msg.key.fromMe) {
          recordGroupActivity(msg.key.remoteJid, senderJid);
        }

        queueIncomingMessage(msg, async () => {
          try {
            const runtime = getRuntimeSettings();
            const commandPrefix = runtime.prefix || _prefix;
            const gameText =
              msg.message?.conversation ||
              msg.message?.extendedTextMessage?.text ||
              msg.message?.imageMessage?.caption ||
              msg.message?.videoMessage?.caption ||
              "";

            if (await handleGiveawayReaction({ sock, msg })) return;

            // ── 1. AFK Clear Check (Runs BEFORE Command Routing) ────────────
            const isAfkCommand = isAfkCommandMessage(msg, commandPrefix);
            if (!isAfkCommand && !msg.key.fromMe) {
              const senderAfkEntry = await findAfkEntry(senderJid);
              const senderAfk = senderAfkEntry?.data;
              const afkOwnerJid = senderAfkEntry?.jid || senderJid;
              if (senderAfk) {
                // Claim the database record atomically. Duplicate WhatsApp
                // deliveries must not produce duplicate welcome messages.
                try {
                  const clearedAfk = await clearAfk(afkOwnerJid);
                  deleteAfkUser(afkOwnerJid);

                  if (!clearedAfk) {
                    // Another delivery already claimed this AFK record.
                    return;
                  }

                  const awaySince = clearedAfk.time || senderAfk.time;
                  const elapsed = Math.floor((Date.now() - awaySince) / 60000);
                  const hrs = Math.floor(elapsed / 60);
                  const mins = elapsed % 60;
                  const timeStr = elapsed < 1 ? "less than a minute" : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
                  const phone = senderJid.split("@")[0];

                  await sock.sendMessage(msg.key.remoteJid, {
                    text: `✨ *@${phone}* is back\nAway: ${timeStr}`,
                    mentions: [senderJid],
                  }, { quoted: msg });
                } catch (e) {
                  log("error", "Failed to clear AFK state from DB: " + String(e));
                }
              }
            }

            const isCommandMessage = gameText.trimStart().startsWith(commandPrefix);

            // ── 2. Fast-path command processing ─────────────────────────────
            if (isCommandMessage) {
              const wasMuted = await mutedUserHandler({ sock, msg });
              if (wasMuted) return;

              void Promise.allSettled([
                antiLinkHandler({ sock, msg }),
                antibadwordHandler({ sock, msg }),
                antispamHandler({ sock, msg }),
                antimentionHandler({ sock, msg }),
              ]);

              await routeMessage(
                sock,
                msg,
                commandPrefix,
                runtime.ownerNumber,
                msg.key.fromMe === true
              );
              return;
            }

            // ── 3. Non-Command Message Checks ───────────────────────────────
            const wasMuted = await mutedUserHandler({ sock, msg });
            if (wasMuted) return;

            // Interactive games
            if (await handleKordGameText({ sock, msg, sender: senderJid, text: gameText, prefix: commandPrefix })) {
              return;
            }

            // Mentioned AFK check
            const messageContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
            const contextInfo = Object.values(messageContent || {}).find((v) => v && typeof v === "object" && v.contextInfo)?.contextInfo;
            const rawMentionedJids = contextInfo?.mentionedJid ?? [];
            const mentionedJids = rawMentionedJids.map(cleanJid);

            for (const jid of mentionedJids) {
              const afkEntry = await findAfkEntry(jid);
              const afkData = afkEntry?.data;
              if (afkData) {
                const phone = jid.split("@")[0];
                void sock.sendMessage(msg.key.remoteJid, {
                  text: `😴 *@${afkData.username || afkData.name || phone}* is AFK: _${afkData.reason || "No reason given"}_ · away for ${Math.max(0, Math.floor((Date.now() - Number(afkData.since || afkData.time || afkData.timestamp || Date.now())) / 60000))} min.`,
                  mentions: [jid],
                }, { quoted: msg });
              }
            }

            // Concurrent execution of non-command background services
            await Promise.allSettled([
              antiLinkHandler({ sock, msg }),
              antibadwordHandler({ sock, msg }),
              antispamHandler({ sock, msg }),
              antimentionHandler({ sock, msg }),
              akiraHandler({ sock, msg, prefix: commandPrefix }),
              handleTodText(sock, msg),
              handleAnimeQuizText(sock, msg, getUser, saveUser),
            ]);

          } catch (err) {
            log("error", "Plugin error: " + String(err));
          }
        });
      }
    });

    sock.ev.on("group-participants.update", async (update) => {
      try {
        await handleGroupParticipants(sock, update);
      } catch (err) {
        log("error", "Group participant event error: " + String(err));
      }
    });

  } catch (err) {
    log("error", "Bot init failed: " + String(err));
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connectBot(null, _prefix), 10_000);
  }
}

async function findAfkEntry(jid) {
  const raw = String(jid || "").trim();
  const local = raw.split("@")[0].split(":")[0];
  const candidates = [...new Set([raw, `${local}@s.whatsapp.net`, `${local}@lid`, local].filter(Boolean))];
  for (const candidate of candidates) {
    const data = getAfkUser(candidate) || await getStoredAfk(candidate);
    if (data) return { jid: candidate, data };
  }
  return null;
}

async function getStoredAfk(rawJid) {
  try {
    const jid = cleanJid(rawJid);
    return await shortRead(jid, () => getAfkStatus(jid));
  } catch {
    return null;
  }
}

function isAfkCommandMessage(msg, prefix) {
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (!prefix || !body.startsWith(prefix)) return false;
  const command = body.slice(prefix.length).trim().split(/\s+/, 1)[0]?.toLowerCase();
  return command === "afk" || command === "away";
}

function showPairingCode(code, number) {
  console.log(`\nPAIRING CODE: ${code} (Number: +${number})\n`);
}
