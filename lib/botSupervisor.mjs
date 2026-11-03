import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { loadBotConfigs } from "./botConfig.mjs";
import { log } from "./logger.mjs";
import { applyGroupSettingsUpdate, getGroupSettingsSnapshot } from "./groupSettings.js";

const workerPath = path.resolve("lib", "bot-worker.mjs");
const workers = new Map();
const blockedWorkers = new Map();
let reconcileTimer = null;
let stopping = false;
let groupSettingsSnapshot = null;

function sendToWorker(child, message) {
  if (!child.connected) return;
  try {
    child.send(message, () => {});
  } catch {
    // A worker may be exiting while settings are being broadcast.
  }
}

function handleWorkerMessage(source, message) {
  if (message?.type === "groupSettings:requestSnapshot") {
    sendToWorker(source, {
      type: "groupSettings:snapshot",
      snapshot: groupSettingsSnapshot,
    });
    return;
  }
  if (message?.type !== "groupSettings:update") return;

  applyGroupSettingsUpdate(message);
  groupSettingsSnapshot = getGroupSettingsSnapshot();
  for (const { child } of workers.values()) {
    if (child !== source) sendToWorker(child, message);
  }
}

function configKey(config) {
  return JSON.stringify({
    id: config.id,
    sessionFolder: config.sessionFolder,
    phoneNumber: config.phoneNumber,
    ownerNumber: config.ownerNumber,
    ownerName: config.ownerName,
    botName: config.botName,
    prefix: config.prefix,
    enabled: config.enabled,
    channelAnnouncementRelayEnabled: config.channelAnnouncementRelayEnabled === true,
  });
}

function stopWorker(id, reason = "configuration change") {
  const current = workers.get(id);
  if (!current) return;
  log("info", `[bots] Stopping ${id}: ${reason}`);
  current.child.kill("SIGTERM");
  workers.delete(id);
}

function startWorker(config) {
  if (stopping) return;
  const existing = workers.get(config.id);
  const key = configKey(config);
  if (blockedWorkers.get(config.id) === key) return;
  if (blockedWorkers.has(config.id)) blockedWorkers.delete(config.id);
  if (existing?.key === key && !existing.child.killed) return;
  if (existing) stopWorker(config.id);

  if (!existsSync(workerPath)) {
    throw new Error(`Bot worker not found: ${workerPath}`);
  }

  const child = spawn(process.execPath, [workerPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BOT_CONFIG_JSON: JSON.stringify(config),
    },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
  });

  child.on("message", (message) => handleWorkerMessage(child, message));
  workers.set(config.id, { child, key });
  log("info", `[bots] Started ${config.id} (pid ${child.pid})`);

  child.once("exit", (code, signal) => {
    const current = workers.get(config.id);
    if (current?.child === child) workers.delete(config.id);
    if (code === 42) {
      blockedWorkers.set(config.id, key);
      log(
        "error",
        `[bots] ${config.id} is paused after WhatsApp replaced its session. Remove the duplicate process/session, then change or restart this bot.`,
      );
    } else if (!stopping && code !== 0 && signal !== "SIGTERM") {
      log("warn", `[bots] ${config.id} stopped (code ${code ?? "?"}); it will be restarted on the next scan.`);
    }
  });

  child.once("error", (error) => {
    log("error", `[bots] ${config.id} worker error: ${error.message}`);
  });
}

function reconcile() {
  if (stopping) return;
  const definitions = loadBotConfigs().sort((left, right) => left.id.localeCompare(right.id));
  // Only one account follows and forwards each announcement to avoid duplicates.
  const relayLeaderId = definitions[0]?.id;
  const configs = definitions.map((config) => ({
    ...config,
    channelAnnouncementRelayEnabled: config.id === relayLeaderId,
    webAuctionAnnouncementsEnabled: config.id === relayLeaderId,
  }));
  const activeIds = new Set(configs.map((config) => config.id));

  for (const id of workers.keys()) {
    if (!activeIds.has(id)) {
      stopWorker(id, "bot definition removed or disabled");
      blockedWorkers.delete(id);
    }
  }
  for (const config of configs) startWorker(config);

  if (!configs.length) {
    log("warn", "[bots] No bots found. Add a credential folder under .bots/<id>/.");
  }
}

export async function startBotSupervisor({ initialGroupSettingsSnapshot = null } = {}) {
  groupSettingsSnapshot = initialGroupSettingsSnapshot;
  reconcile();
  reconcileTimer = setInterval(reconcile, 10_000);
  log("info", "[bots] Watching .bots/ for new, changed, or disabled bot definitions.");

  const stopAll = () => {
    if (stopping) return;
    stopping = true;
    if (reconcileTimer) clearInterval(reconcileTimer);
    for (const id of workers.keys()) stopWorker(id, "server shutdown");
  };

  process.once("SIGINT", stopAll);
  process.once("SIGTERM", stopAll);
}