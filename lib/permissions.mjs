/**
 * KELIN MD — Permission System
 *
 * Owner detection uses the configured owner phone number only.
 * A message being sent by the bot itself (`fromMe`) never grants owner access.
 *
 * Owner number source of truth (in priority order):
 *   OWNER_NUMBERS / OWNER_NUMBER env vars  →  runtime settings  →  settings.js
 *
 * Mod/staff source of truth: data/mods.json (managed by staff commands)
 * Premium/jail/staffLevel: MongoDB (falls back gracefully if unavailable)
 */

import { createRequire } from "module";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { getRuntimeSettings } from "./runtimeSettings.mjs";
import { getDb } from "./mongo.mjs";
import { resolveLidToJid, findUserByIdentity, normalizeJid } from "./identity.mjs";
import {
  matchesAnyOwnerPhone,
  normalizeOwnerNumbers,
  resolveOwnerPhone,
} from "./ownerIdentity.mjs";

// Import settings.js (CommonJS) — this is the canonical owner number source
const _require  = createRequire(import.meta.url);
const _settings = _require("../settings.cjs");

const MODS_FILE = path.resolve("data", "mods.json");
const PERMISSION_CACHE_TTL_MS = 5_000;
const permissionCache = new Map();
const permissionInFlight = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve the owner's bare phone digits from all possible sources.
 * Runtime settings are passed by the bot and include .botconfig changes.
 * Fall back to OWNER_NUMBER and settings.cjs for panel deployments.
 */
function getOwnerDigits(passedParam = "") {
  return resolveOwnerPhone({
    environment: process.env.OWNER_NUMBER,
    runtime: getRuntimeSettings().ownerNumber,
    passed: passedParam,
    settings: _settings.ownerNumber,
  });
}

/** Return every configured owner, including the per-bot OWNER_NUMBERS list. */
export function getOwnerNumbers(passedParam = "") {
  return normalizeOwnerNumbers(
    process.env.OWNER_NUMBERS,
    getOwnerDigits(passedParam),
  );
}

/**
 * Strip a JID to bare phone digits.
 * "27628114340:5@s.whatsapp.net" → "27628114340"
 * "27628114340@s.whatsapp.net"   → "27628114340"
 * "123456:0@lid"                 → "123456"
 */
function jidToNum(jid = "") {
  return jid.split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * Resolve a @lid group JID to the member's real phone number.
 * WhatsApp started sending @lid privacy addresses in groups (2024).
 */
export async function resolveLid(senderJid, sock, chatId) {
  const resolved = await resolveLidToJid(senderJid, sock, chatId);
  return resolved.endsWith("@s.whatsapp.net") ? jidToNum(resolved) : null;
}

// ── Mods file helpers (public — used by mods.js plugin) ──────────────────────

/**
 * Returns raw mod data: array of { num, name } objects.
 * Handles both old format (list of strings) and new format (list of objects).
 */
export function getModsData() {
  try {
    if (existsSync(MODS_FILE)) {
      const parsed = JSON.parse(readFileSync(MODS_FILE, "utf8"));
      const list = Array.isArray(parsed.list) ? parsed.list : [];
      // Normalise: old entries were plain strings
      return list.map(entry =>
        typeof entry === "string" ? { num: entry, name: entry } : entry
      );
    }
  } catch { /* ignore */ }
  return [];
}

/** Returns just the bare number strings — used for permission checks. */
export function getMods() {
  return getModsData().map(e => e.num);
}

/** Saves an array of { num, name } objects. */
export function saveModsData(data) {
  try {
    const dir = path.dirname(MODS_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(MODS_FILE, JSON.stringify({ list: data }, null, 2));
  } catch (err) {
    console.error("[permissions] Failed to save mods:", err.message);
  }
}

/** Legacy compat — accepts plain string array (converts to { num, name }). */
export function saveMods(list) {
  saveModsData(list.map(n => (typeof n === "string" ? { num: n, name: n } : n)));
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Build the full permission context for a message sender.
 *
 * @param {string}  sender      – full JID e.g. "27628114340@s.whatsapp.net"
 * @param {string}  ownerNumber – raw owner number from caller (optional — settings.js used as fallback)
 * @param {object}  opts
 * @param {object}  [opts.sock]          – Baileys socket (for @lid lookup)
 * @param {string}  [opts.chatId]        – msg.key.remoteJid (for @lid lookup)
 */
export async function getPermissions(sender, ownerNumber = "", { sock, chatId } = {}) {
  const ownerNumbers = getOwnerNumbers(ownerNumber);
  const ownerDigits = ownerNumbers.join(",");
  let senderNum = sender.endsWith("@lid") ? "" : jidToNum(sender);

  if (ownerNumbers.length) {
    // ── 2. Direct digit comparison ──────────────────────────────────────────
    if (senderNum && matchesAnyOwnerPhone(senderNum, ownerNumbers)) return _ownerPerms();

    // ── 3. @lid group privacy JID resolution ────────────────────────────────
    if (sender.endsWith("@lid") && sock) {
      const resolved = await resolveLid(sender, sock, chatId);
      if (resolved) senderNum = resolved;
      if (resolved && matchesAnyOwnerPhone(resolved, ownerNumbers)) return _ownerPerms();
    }
  }

  // Most users send several commands close together. Reusing a very short
  // permission snapshot avoids one MongoDB read per command without making
  // staff, premium, jail, or ban changes stale for long.
  const cacheKey = `${normalizeJid(sender)}|${ownerDigits}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < PERMISSION_CACHE_TTL_MS) {
    return cached.value;
  }

  // ── Non-owner: check mods list ────────────────────────────────────────────
  const mods        = getMods();
  const isModByFile = mods.includes(senderNum);

  // Coalesce simultaneous commands from the same sender. Without this, two
  // commands arriving in the per-sender concurrent lane can issue duplicate
  // MongoDB permission reads before either one populates the short-lived cache.
  const existingPermissionCheck = permissionInFlight.get(cacheKey);
  if (existingPermissionCheck) return existingPermissionCheck;

  const permissionCheck = (async () => {
    // ── Optional MongoDB enrichment ─────────────────────────────────────────
    try {
      const db   = getDb();
      const user = await findUserByIdentity(
        sender,
        { projection: { staffLevel: 1, isPremium: 1, membershipTier: 1, jailed: 1, jailUntil: 1, staffImmunity: 1, banned: 1, registered: 1 } }
      );

      // Mods file always grants at least level 1
      const staffLevel = Math.max(user?.staffLevel ?? 0, isModByFile ? 1 : 0);

      let isJailed = !!(user?.jailed);
      if (isJailed && user?.jailUntil && user.jailUntil <= Date.now()) {
        isJailed = false;
        db.collection("users")
          .updateOne({ _id: user._id }, { $set: { jailed: false, jailUntil: null } })
          .catch(() => {});
      }

      const value = {
        isOwner:       false,
        isStaff:       staffLevel >= 2,
        isMod:         staffLevel >= 1 || isModByFile,
        isPremium:     !!(user?.isPremium) || staffLevel >= 1 || isModByFile,
        membershipTier: user?.membershipTier || "none",
        isJailed,
        isBanned:      !!(user?.banned),
        moderationStatusAvailable: true,
        registered:    user ? user.registered === true : false,
        staffImmunity: !!(user?.staffImmunity) || staffLevel >= 2,
        staffLevel,
      };
      permissionCache.set(cacheKey, { createdAt: Date.now(), value });
      return value;
    } catch {
      // MongoDB not available — mods.json is the only source
      const value = {
        isOwner:       false,
        isStaff:       false,
        isMod:         isModByFile,
        isPremium:     isModByFile,
        membershipTier: "none",
        isJailed:      false,
        isBanned:      false,
        moderationStatusAvailable: false,
        registered:    null,
        staffImmunity: false,
        staffLevel:    isModByFile ? 1 : 0,
      };
      permissionCache.set(cacheKey, { createdAt: Date.now(), value });
      return value;
    }
  })();

  permissionInFlight.set(cacheKey, permissionCheck);
  try {
    return await permissionCheck;
  } finally {
    if (permissionInFlight.get(cacheKey) === permissionCheck) {
      permissionInFlight.delete(cacheKey);
    }
  }
}

function _ownerPerms() {
  return {
    isOwner:       true,
    isStaff:       true,
    isMod:         true,
    isPremium:     true,
    membershipTier: "premium",
    isJailed:      false,
    isBanned:      false,
    moderationStatusAvailable: true,
    registered:    true,
    staffImmunity: true,
    staffLevel:    99,
  };
}

export function invalidatePermissionCache(jid) {
  const prefixes = new Set([
    `${String(jid || "")}|`,
    `${normalizeJid(String(jid || ""))}|`,
  ]);
  for (const key of permissionCache.keys()) {
    if ([...prefixes].some((prefix) => key.startsWith(prefix))) permissionCache.delete(key);
  }
}

// ── Standalone helpers (importable by any plugin) ─────────────────────────────

/** Returns true if jid is the owner (no sock/chatId needed for DM checks). */
export async function isOwnerCheck(jid, ownerNumber = "") {
  const p = await getPermissions(jid, ownerNumber);
  return p.isOwner;
}

/** Returns true if jid is a mod (checks mods.json + MongoDB). */
export async function isMod(jid, ownerNumber = "") {
  const p = await getPermissions(jid, ownerNumber);
  return p.isMod;
}
