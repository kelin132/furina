/**
 * Discover bot definitions from .bots/.
 *
 * Supported layouts:
 *   .bots/Elyra.json
 *   .bots/Viora/config.json
 *   .bots/sessions.config.json   (array)
 *   .bots/Elyra/cred.json       (credentials-only auto discovery)
 *   .bots/Viora/creds.json      (credentials-only auto discovery)
 *
 * Authentication files are never treated as definitions. Each bot's
 * sessionFolder is independent, so any number of accounts can run in one
 * Node server without sharing creds or reconnect state.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { normalizeOwnerNumbers } from "./ownerIdentity.mjs";

const BOTS_DIR = path.resolve(".bots");
const IGNORED_CONFIG_NAMES = new Set([
  "creds.json",
  "cred.json",
  "package.json",
]);

function readJson(filePath) {
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch (error) {
    console.error(`[bots] Cannot read ${filePath}: ${error.message}`);
    return null;
  }
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function safeId(value, fallback) {
  const id = String(value || fallback || "").trim();
  const normalized = id.replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return normalized.replace(/^-|-$/g, "").slice(0, 64) || fallback;
}

function normalizeConfig(raw, sourcePath, fallbackId, defaultSessionFolder = "") {
  if (!raw || Array.isArray(raw)) return null;

  const id = safeId(raw.id || raw.name, fallbackId);
  const sessionFolder = String(
    raw.sessionFolder || defaultSessionFolder || path.join(".bots", id),
  );
  const owners = normalizeOwnerNumbers(raw.ownerNumber, raw.ownerNumbers);
  const phoneNumber = digits(raw.phoneNumber || raw.botNumber || raw.number);

  return {
    id,
    sourcePath,
    sessionFolder,
    phoneNumber,
    ownerNumber: owners,
    ownerName: String(raw.ownerName || raw.owner || id).trim().slice(0, 80),
    botName: String(raw.botName || id).trim().slice(0, 80),
    prefix: String(raw.prefix || ".").trim().slice(0, 4) || ".",
    enabled: raw.enabled !== false,
  };
}

function credentialLocations(folder) {
  const locations = [];
  for (const candidateFolder of [folder, path.join(folder, "auth")]) {
    for (const fileName of ["creds.json", "cred.json"]) {
      const filePath = path.join(candidateFolder, fileName);
      if (existsSync(filePath)) locations.push({ folder: candidateFolder, fileName, filePath });
    }
  }
  return locations;
}

function credentialLocation(folder) {
  const locations = credentialLocations(folder);
  return locations.length === 1 ? locations[0] : null;
}

function credentialIdentity(folder, fileName) {
  const credentialPath = path.join(folder, fileName);
  const credentials = readJson(credentialPath);
  const meId = credentials?.me?.id || credentials?.creds?.me?.id || "";
  const phoneNumber = digits(String(meId).split("@")[0].split(":")[0]);
  return phoneNumber ? { phoneNumber, ownerNumber: [phoneNumber] } : {};
}

function credentialFolder(folder) {
  const locations = credentialLocations(folder);
  if (locations.length > 1) {
    console.error(
      `[bots] Multiple credential files found under ${folder}; use exactly one cred.json or creds.json.`,
    );
  }
  return locations.length === 1 ? locations[0].folder : null;
}

function hasRegisteredCredentials(folder) {
  const location = credentialLocation(folder);
  if (!location) return false;
  const credentials = readJson(location.filePath);
  return credentials?.registered === true || credentials?.creds?.registered === true;
}

function collectDefinitions() {
  if (!existsSync(BOTS_DIR)) return [];

  const definitions = [];
  const entries = readdirSync(BOTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "README.md") continue;
    const entryPath = path.join(BOTS_DIR, entry.name);

    if (entry.isDirectory()) {
      const discoveredCredentialFolder = credentialFolder(entryPath);
      const configPath = ["config.json", "bot.json", `${entry.name}.json`]
        .map((name) => path.join(entryPath, name))
        .find(existsSync);
      if (configPath) {
        const defaultSessionFolder = discoveredCredentialFolder
          ? path.relative(process.cwd(), discoveredCredentialFolder)
          : path.relative(process.cwd(), entryPath);
        const config = normalizeConfig(
          readJson(configPath),
          configPath,
          entry.name,
          defaultSessionFolder,
        );
        if (config) definitions.push(config);
      } else {
        // Keep the common single-bot auth workflow simple: a folder that
        // contains Baileys credentials is enough to define a bot. This also
        // accepts an auth subfolder copied from the legacy setup.
        if (discoveredCredentialFolder) {
          const location = credentialLocation(entryPath);
          const identity = location
            ? credentialIdentity(location.folder, location.fileName)
            : {};
          definitions.push(normalizeConfig({
            id: entry.name,
            sessionFolder: path.relative(process.cwd(), discoveredCredentialFolder),
            ...identity,
          }, discoveredCredentialFolder, entry.name));
        }
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (IGNORED_CONFIG_NAMES.has(entry.name.toLowerCase())) continue;

    const value = readJson(entryPath);
    if (Array.isArray(value)) {
      for (const item of value) {
        const config = normalizeConfig(item, entryPath, item?.id || "bot");
        if (config) definitions.push(config);
      }
      continue;
    }

    const config = normalizeConfig(value, entryPath, path.basename(entry.name, ".json"));
    if (config) definitions.push(config);
  }

  definitions.sort((left, right) => {
    const score = (config) => {
      const source = path.resolve(config.sourcePath);
      const sourceName = path.basename(source, path.extname(source));
      const parentName = path.basename(path.dirname(source));
      return sourceName === config.id || parentName === config.id ? 1 : 0;
    };
    return score(right) - score(left);
  });

  const unique = new Map();
  for (const config of definitions) {
    if (!config.enabled) continue;
    const idKey = config.id.toLowerCase();
    if (unique.has(idKey)) {
      const existing = unique.get(idKey);
      console.error(
        `[bots] Duplicate bot id "${config.id}" in ${config.sourcePath}; keeping ${existing.sourcePath}.`,
      );
      continue;
    }
    unique.set(idKey, config);
  }
  const usedFolders = new Map();
  return [...unique.values()].filter((config) => {
    const requestedFolder = path.resolve(config.sessionFolder);
    const actualFolder = credentialFolder(requestedFolder);
    if (!actualFolder) {
      console.error(
        `[bots] Skipping ${config.id}: expected exactly one cred.json or creds.json in ${requestedFolder} or its auth/ folder.`,
      );
      return false;
    }
    if (!hasRegisteredCredentials(actualFolder)) {
      console.error(
        `[bots] Skipping ${config.id}: credentials are missing or not registered; pairing codes are disabled for .bots.`,
      );
      return false;
    }

    const canonicalFolder = path.resolve(actualFolder);
    const previousId = usedFolders.get(canonicalFolder);
    if (previousId) {
      console.error(
        `[bots] Duplicate session folder ${canonicalFolder} for ${config.id}; already used by ${previousId}.`,
      );
      return false;
    }
    usedFolders.set(canonicalFolder, config.id);
    config.sessionFolder = path.relative(process.cwd(), actualFolder);
    return true;
  });
}

export function loadBotConfigs() {
  return collectDefinitions();
}

export function hasBotConfigDirectory() {
  return existsSync(BOTS_DIR) && statSync(BOTS_DIR).isDirectory();
}

export function hasBotEntries() {
  if (!hasBotConfigDirectory()) return false;
  return readdirSync(BOTS_DIR, { withFileTypes: true }).some((entry) =>
    !entry.name.startsWith(".") && entry.name !== "README.md"
  );
}