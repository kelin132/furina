/**
 * One isolated bot worker.
 *
 * The supervisor starts one worker process per .bots definition. Keeping the
 * Baileys socket and plugin module state in the worker means reconnects,
 * credentials, queues, and bot-specific settings cannot collide.
 */
import "dotenv/config";
import { existsSync, readFileSync } from "fs";
import path from "path";

const config = JSON.parse(process.env.BOT_CONFIG_JSON || "{}");
const owners = Array.isArray(config.ownerNumber) ? config.ownerNumber : [];
const requestedFolder = path.resolve(String(config.sessionFolder || `.bots/${config.id || "bot"}`));

function findCredential(folder) {
  const matches = [];
  for (const candidateFolder of [folder, path.join(folder, "auth")]) {
    for (const fileName of ["creds.json", "cred.json"]) {
      const filePath = path.join(candidateFolder, fileName);
      if (existsSync(filePath)) matches.push({ folder: candidateFolder, fileName, filePath });
    }
  }
  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.error(
        `[bots] ${config.id || "bot"} has multiple credential files; refusing to choose between ${matches.map((match) => match.filePath).join(", ")}.`,
      );
    }
    return null;
  }
  return matches[0];
}

const credential = findCredential(requestedFolder);
if (!credential) {
  console.error(
    `[bots] ${config.id || "bot"} needs exactly one cred.json or creds.json in ${requestedFolder} or its auth/ folder; not starting.`,
  );
  process.exit(0);
}

let credentialData;
try {
  credentialData = JSON.parse(readFileSync(credential.filePath, "utf8"));
} catch (error) {
  console.error(`[bots] ${config.id || "bot"} has invalid ${credential.fileName}: ${error.message}`);
  process.exit(0);
}
if (credentialData?.registered !== true) {
  console.error(
    `[bots] ${config.id || "bot"} has an unregistered session; pairing codes are disabled for .bots.`,
  );
  process.exit(0);
}

process.env.BOT_ID = String(config.id || "bot");
process.env.BOT_CHANNEL_ANNOUNCEMENT_RELAY =
  config.channelAnnouncementRelayEnabled === true ? "true" : "false";
process.env.BOT_WEB_AUCTION_ANNOUNCEMENTS =
  config.webAuctionAnnouncementsEnabled === true ? "true" : "false";
process.env.SESSION_DIR = credential.folder;
process.env.SESSION_CREDENTIAL_FILE = credential.fileName;
process.env.BOT_NUMBER = "";
process.env.DISABLE_PAIRING_CODE = "1";
process.env.OWNER_NUMBER = owners[0] || "";
process.env.OWNER_NUMBERS = owners.join(",");
process.env.BOT_NAME = String(config.botName || config.id || "KELIN MD");
process.env.BOT_OWNER_NAME = String(config.ownerName || config.id || "Owner");
process.env.PREFIX = String(config.prefix || ".");

const [{ connectBot }, { loadPlugins }, { connectDb }, { initGroupSettings, requestGroupSettingsSnapshot }, { log }] =
  await Promise.all([
    import("./bot.mjs"),
    import("./pluginManager.mjs"),
    import("./mongo.mjs"),
    import("./groupSettings.js"),
    import("./logger.mjs"),
  ]);

const botLabel = `${process.env.BOT_NAME} [${process.env.BOT_ID}]`;
console.log(`\n[bots] Starting ${botLabel}`);
console.log(`[bots] Session folder: ${process.env.SESSION_DIR}`);
console.log(`[bots] Login: existing ${process.env.SESSION_CREDENTIAL_FILE} only`);

try {
  await connectDb();
  const snapshot = await requestGroupSettingsSnapshot();
  if (snapshot) await initGroupSettings(snapshot);
  else await initGroupSettings();
} catch (error) {
  log("warn", `[${process.env.BOT_ID}] MongoDB unavailable; continuing in degraded mode: ${error.message}`);
}

const { totalPlugins, totalCommands } = await loadPlugins(process.env.PREFIX);
log("info", `[${process.env.BOT_ID}] Plugins loaded: ${totalPlugins} plugins, ${totalCommands} commands`);

if (!process.env.BOT_NUMBER) {
  log("info", `[${process.env.BOT_ID}] No phoneNumber configured; using the existing ${process.env.SESSION_CREDENTIAL_FILE} session.`);
}

await connectBot(process.env.BOT_NUMBER || null, process.env.PREFIX);