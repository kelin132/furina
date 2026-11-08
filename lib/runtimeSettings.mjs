/**
 * Runtime bot settings shared by the owner configuration command and the bot.
 *
 * The command updates both .env (for the next restart) and this small JSON
 * snapshot (for panel hosts where .env is not writable or is not persistent).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const staticSettings = require("../settings.cjs");
const DATA_DIR = path.resolve("data");
const SETTINGS_FILE = path.join(DATA_DIR, "botSettings.json");
const ENV_FILE = path.resolve(".env");

const DEFAULT_BOT_IMAGE =
  "https://cdn.phototourl.com/free/2026-07-26-ef31287b-f8c8-4bec-943a-cf435a79d5ad.jpg";

const ENV_KEYS = {
  ownerNumber: "OWNER_NUMBER",
  botName: "BOT_NAME",
  botImage: "BOT_IMAGE",
  prefix: "PREFIX",
  layout: "BOT_LAYOUT",
};

function readSnapshot() {
  if (!existsSync(SETTINGS_FILE)) return {};
  try {
    const value = JSON.parse(readFileSync(SETTINGS_FILE, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function baseSettings() {
  const saved = readSnapshot();
  return {
    // Per-bot workers set these environment values before importing the bot.
    // Environment values therefore take precedence over the shared snapshot.
    ownerNumber: digits(process.env.OWNER_NUMBER || saved.ownerNumber || staticSettings.ownerNumber),
    botName: String(process.env.BOT_NAME || saved.botName || staticSettings.botName || "AIDORU Bot"),
    botImage: String(process.env.BOT_IMAGE || saved.botImage || DEFAULT_BOT_IMAGE),
    prefix: String(process.env.PREFIX || saved.prefix || "."),
    layout: Number(saved.layout || process.env.BOT_LAYOUT || 1),
  };
}

export function getRuntimeSettings() {
  const settings = baseSettings();
  if (![1, 2, 3, 4].includes(settings.layout)) settings.layout = 1;
  return settings;
}

function safeEnvValue(value) {
  return JSON.stringify(String(value));
}

function writeEnvValue(key, value) {
  const line = `${key}=${safeEnvValue(value)}`;
  let content = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const pattern = new RegExp(`^${key}=.*$`, "m");
  content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
  writeFileSync(ENV_FILE, content, "utf8");
}

export function updateRuntimeSetting(setting, value) {
  const envKey = ENV_KEYS[setting];
  if (!envKey) throw new Error(`Unsupported bot setting: ${setting}`);

  const current = getRuntimeSettings();
  const next = { ...current, [setting]: value };

  if (setting === "ownerNumber") next.ownerNumber = digits(value);
  if (setting === "botName") next.botName = String(value).trim().slice(0, 60);
  if (setting === "botImage") next.botImage = String(value).trim();
  if (setting === "prefix") next.prefix = String(value).trim().slice(0, 4);
  if (setting === "layout") next.layout = Number(value);

  if (setting === "ownerNumber" && next.ownerNumber.length < 7) {
    throw new Error("Owner number must include a country code and at least 7 digits.");
  }
  if (setting === "botName" && !next.botName) throw new Error("Bot name cannot be empty.");
  if (setting === "botImage" && !/^https?:\/\/\S+$/i.test(next.botImage)) {
    throw new Error("Bot image must be a valid http(s) URL.");
  }
  if (setting === "prefix" && (!next.prefix || /\s/.test(next.prefix))) {
    throw new Error("Prefix must be 1–4 non-space characters.");
  }
  if (setting === "layout" && ![1, 2, 3, 4].includes(next.layout)) {
    throw new Error("Menu layout must be 1, 2, 3, or 4.");
  }

  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
  writeEnvValue(envKey, next[setting]);
  process.env[envKey] = String(next[setting]);
  return next;
}

export const DEFAULT_MENU_IMAGE = DEFAULT_BOT_IMAGE;