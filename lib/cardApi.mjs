/**
 * KELIN MD — Card API helper
 * Fetches the normal-card snapshot from EulaCard and caches it for 1 hour.
 * Event-tagged cards are excluded before they enter the bot's catalog.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { getSeriesCached, prefetchSeries } from "./seriesEnrich.mjs";
import { getCardClaimId } from "./cardClaimId.mjs";

const API_ORIGIN = "https://cardapi.eulaorg.app";
const API_BASE = `${API_ORIGIN}/api/download`;
const API_RANDOM_BASE = `${API_ORIGIN}/api/random`;
const LEGACY_API_HOST = "eula-cardapi.suhotech.xyz";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const API_FETCH_TIMEOUT_MS = 45_000;  // The full card snapshot is about 62 MB.
const RANDOM_FETCH_TIMEOUT_MS = 15_000;
const RANDOM_EVENT_RETRIES = 3;
const MEDIA_FETCH_TIMEOUT_MS = 30_000; // 30 seconds for downloading card images
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const execFileAsync = promisify(execFile);
const MEDIA_CACHE_DIR = join(tmpdir(), "kelin-md-card-media");
const MEDIA_CACHE_VERSION = "v4-validated-transcode";
const CARD_VIDEO_CACHE = new Map();
const CARD_IMAGE_CACHE = new Map();
const MAX_MEDIA_CACHE_ENTRIES = 24;

mkdirSync(MEDIA_CACHE_DIR, { recursive: true });

function getCachedMedia(cache, key) {
  if (!cache.has(key)) return null;
  const value = cache.get(key);
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function setCachedMedia(cache, key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > MAX_MEDIA_CACHE_ENTRIES) {
    cache.delete(cache.keys().next().value);
  }
}

// ── Tier mappings ─────────────────────────────────────────────────────────────

export const TIER_NAME = {
  "1": "Common",
  "2": "Uncommon",
  "3": "Rare",
  "4": "Epic",
  "5": "Legendary",
  "6": "Mythical",
  "S": "Secret",
  "C": "C",
  "R": "R",
  "SR": "SR",
  "SSR": "SSR",
  "UR": "UR",
  "X": "X",
};

export const TIER_NUM = {
  "common":    "1",
  "uncommon":  "2",
  "rare":      "3",
  "epic":      "4",
  "legendary": "5",
  "mythical":  "6",
  "secret":    "S",
  "s":         "S",
  "tier s":    "S",
  "c": "C",
  "tier c": "C",
  "r": "R",
  "tier r": "R",
  "sr": "SR",
  "tier sr": "SR",
  "ssr": "SSR",
  "tier ssr": "SSR",
  "ur": "UR",
  "tier ur": "UR",
  "x": "X",
  "tier x": "X",
  "1": "1", "2": "2", "3": "3", "4": "4", "5": "5", "6": "6",
  "S": "S", "C": "C", "R": "R", "SR": "SR", "SSR": "SSR", "UR": "UR", "X": "X",
};

export const TIER_EMOJI = {
  Common: "⚪", Uncommon: "🟢", Rare: "🔵", Epic: "🟣", Legendary: "🟡", Mythical: "🔴", Secret: "🌟",
  C: "💠", R: "🔷", SR: "🟣", SSR: "💎", UR: "🌠", X: "✨",
};

export function formatCardLabel(card) {
  const name = String(card?.name || "Unknown").trim() || "Unknown";
  const tier = String(card?.tier || (card?.tierNum ? `T${card.tierNum}` : "Unknown")).trim() || "Unknown";
  return `🃏 *${name}* (Tier: ${tier})`;
}

export const TIER_PRICE = {
  Common:    [1000, 10000],
  Uncommon:  [10000, 30000],
  Rare:      [30000, 60000],
  Epic:      [60000, 80000],
  Legendary: [80000, 100000],
  Mythical:  [100000, 300000],
  Secret:    [300000, 600000],
  C:         [600000, 800000],
  R:         [800000, 1000000],
  SR:        [1000000, 5000000],
  SSR:       [5000000, 10000000],
  UR:        [10000000, 20000000],
  X:         [20000000, 50000000],
};

export function createSpawnId() {
  return Math.random().toString(16).slice(2, 7).padEnd(5, "0");
}

/** Build the shared bordered caption used by manual and automatic card spawns. */
export function buildCardSpawnCaption(card, spawnId) {
  const claimId = getCardClaimId(card);
  return `╭─❀「 🃏 *𝐂𝐀𝐑𝐃 𝐒𝐏𝐀𝐖𝐍* 」❀─╮
│ ${formatCardLabel(card)}
│ 📺 *Series* :: *${card.series}*
│ 🆔 *Claim #* :: \`${claimId}\`
│ 🔹 *Spawn*  :: \`${spawnId}\`
╰───────────────❀`;
}

// Weighted spawn probability (higher weight = more common)
export const TIER_WEIGHTS = [
  { num: "1", weight: 38 },
  { num: "2", weight: 24 },
  { num: "3", weight: 17 },
  { num: "4", weight: 10 },
  { num: "5", weight:  6 },
  { num: "6", weight:  4 },
  { num: "S", weight:  1 },
  // Keep newer card families visible in group auto-spawns. R/SR/UR/X now
  // account for about 10% of drops together instead of being nearly absent.
  { num: "C", weight: 5 },
  { num: "R", weight: 5 },
  { num: "SR", weight: 4 },
  { num: "SSR", weight: 3 },
  { num: "UR", weight: 2 },
  { num: "X", weight: 1.5 },
];
const TOTAL_WEIGHT = TIER_WEIGHTS.reduce((s, t) => s + t.weight, 0);

// ── In-memory cache ───────────────────────────────────────────────────────────

/** @type {{ cards: object[], fetchedAt: number } | null} */
let _cache = null;

/**
 * Return all cards across all tiers, using cache if still fresh.
 * Throws a descriptive CARD_API_DOWN error when the external API is unreachable,
 * so callers can surface a clear message to users instead of a generic failure.
 * @returns {Promise<object[]>}
 */
export async function fetchAllCards() {
  const now = Date.now();
  if (_cache && now - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.cards;
  }

  let sourceCards;
  try {
    const response = await fetch(API_BASE, {
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Card API HTTP ${response.status}`);
    const payload = await response.json();
    sourceCards = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.results)
        ? payload.results
        : Array.isArray(payload?.data)
          ? payload.data
          : null;
    if (!sourceCards) throw new Error("Unexpected card catalog response");
  } catch (error) {
    const err = new Error(
      `Card API is currently unreachable — please try again later. (${error?.message ?? "request failed"})`
    );
    err.code = "CARD_API_DOWN";
    throw err;
  }

  const cards = sourceCards
    .filter(raw => !String(raw?.event ?? "").trim())
    .map((raw, index) => normalise(raw, index + 1));
  if (!cards.length) {
    const err = new Error("The card catalog currently has no non-event cards.");
    err.code = "CARD_API_DOWN";
    throw err;
  }

  _cache = { cards, fetchedAt: Date.now() };

  // Background-enrich series names for cards that are still "Unknown".
  // This runs async without blocking the caller — subsequent fetches
  // from cache will have the enriched series populated by then.
  const unenriched = cards.filter(c => c.series === "Unknown").map(c => c.name);
  if (unenriched.length > 0) prefetchSeries(unenriched);

  return cards;
}

/** Force-clear the cache (useful for testing). */
export function clearCache() { _cache = null; }

/** Move legacy API image URLs onto the currently documented API origin. */
export function normalizeCardMediaUrl(value) {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === LEGACY_API_HOST) url.hostname = new URL(API_ORIGIN).hostname;
    return url.toString();
  } catch {
    return value;
  }
}

// ── Redirect resolver ─────────────────────────────────────────────────────────

/** Map<originalUrl, resolvedUrl> — persists for the process lifetime */
const _urlCache = new Map();

/**
 * Resolve a URL to its final destination, following any 301/302 redirects.
 * Results are cached so each URL is only resolved once.
 * @param {string} url
 * @returns {Promise<string>} Final URL (or original if resolution fails)
 */
export async function resolveMediaUrl(url) {
  if (!url) return url;
  if (!url.includes("asapi.shoob.gg")) return url; // already a direct CDN link
  if (_urlCache.has(url)) return _urlCache.get(url);

  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    const location = res.headers.get("location");
    const resolved = location || url;
    _urlCache.set(url, resolved);
    return resolved;
  } catch {
    return url; // fall back to original on error
  }
}

// ── Card normalisation ────────────────────────────────────────────────────────

/**
 * Normalise a raw API card into a consistent internal shape.
 * Uses the in-memory series cache when available (populated by prefetchSeries).
 */
export function normalise(raw, index) {
  const tierNum  = String(raw.tier ?? "").trim().toUpperCase();
  const tierName = TIER_NAME[tierNum] || `Tier ${tierNum || "?"}`;
  const [min, max] = TIER_PRICE[tierName] || [100, 500];
  const sourcePrice = Number(raw.value);
  const price = raw.value_currency === "coins" && Number.isFinite(sourcePrice) && sourcePrice > 0
    ? Math.round(sourcePrice)
    : Math.floor(Math.random() * (max - min)) + min;
  const declaredMediaType = String(raw.media_type ?? "").trim().toLowerCase();
  const sourceMediaType = String(raw.source_media_type ?? "").trim().toLowerCase();
  // Shoob's Secret-card image proxy can redirect to a GIF while the catalog
  // labels the extensionless proxy URL as a static image.
  const animated = tierNum === "S"
    || ["gif", "video", "animated"].includes(declaredMediaType)
    || raw.is_animated === true
    || sourceMediaType === "video"
    || Boolean(raw.gifUrl)
    || /\.gif(?:$|[?#])/i.test(String(raw.gifUrl || raw.image || raw.url || ""))
    || (/\.webp(?:$|[?#])/i.test(String(raw.image || raw.url || "")) && raw.is_animated === true);
  const media = normalizeCardMediaUrl((animated && raw.gifUrl)
    || raw.image
    || raw.url
    || raw.imageUrl
    || raw.source_image
    || null);
  const mediaType = animated
    ? "gif"
    : "image";
  const mediaFallbacks = [...new Set([
    ...(Array.isArray(raw.image_fallbacks) ? raw.image_fallbacks : []),
    raw.image_preview,
    raw.thumbnailUrl,
    raw.thumbnail,
    raw.source_image,
    raw.imageUrl,
    raw.url,
  ].map(normalizeCardMediaUrl).filter(url => url && url !== media))];

  // Check series enrichment cache (populated async after first full fetch)
  const cachedSeries = getSeriesCached(raw.title);

  return {
    cardId:    String(raw.id || makeId(raw.title || raw.name, tierNum)).toUpperCase(),
    claimId:   getCardClaimId({ name: raw.title || raw.name || "Unknown", tierNum }),
    name:      raw.title || raw.name || "Unknown",
    tier:      tierName,
    tierNum,
    series:    raw.series || cachedSeries || "Unknown",
    index,
    media,
    mediaFallbacks,
    thumbnail: normalizeCardMediaUrl(raw.thumbnailUrl || raw.thumbnail || raw.image_preview || raw.image_fallbacks?.[0] || null),
    mediaType,
    price,
  };
}

/**
 * Generate a stable card ID from its title and tier.
 * e.g. "Zero Two and Hiro", "5" → "5_ZERO_TWO_AND_HIRO"
 */
function makeId(title, tierNum) {
  // Deterministic 5-digit number (10000–99999) from title + tier hash
  let hash = 0;
  const str = `${tierNum}:${title.toUpperCase()}`;
  for (const ch of str) hash = (hash * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  return String(10000 + (hash % 90000));
}

// ── Query helpers ─────────────────────────────────────────────────────────────

/**
 * Pick a random card using weighted tier probability.
 * @returns {Promise<object>}
 */
export async function pickRandomCard() {
  return fetchRandomCard();
}

export function pickRandomTier(random = Math.random) {
  let roll = random() * TOTAL_WEIGHT;
  for (const { num, weight } of TIER_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return num;
  }
  return TIER_WEIGHTS.at(-1)?.num || "1";
}

function normalizeTierInput(tier) {
  const value = String(tier ?? "").trim();
  const key = value.toLowerCase();
  return TIER_NUM[key]
    || TIER_NUM[key.replace(/^tier\s+/, "")]
    || value.toUpperCase();
}

/**
 * Resolve a summon tier or slash-separated tier group to its display name.
 * A group such as "C/R/SR" picks one of those tiers uniformly.
 */
export function resolveSummonTier(input, random = Math.random) {
  const parts = String(input ?? "")
    .trim()
    .split("/")
    .map(part => part.trim().toLowerCase().replace(/^tier\s+/, ""));
  if (!parts.length || parts.some(part => !part)) return null;

  const tierNums = parts.map(part => {
    if (part === "7") return "S";
    const tierNum = TIER_NUM[part] || TIER_NUM[part.toUpperCase()];
    return TIER_NAME[tierNum] ? tierNum : null;
  });
  if (tierNums.some(tierNum => !tierNum)) return null;

  const selected = Math.min(tierNums.length - 1, Math.floor(random() * tierNums.length));
  return TIER_NAME[tierNums[selected]];
}

/**
 * Fetch one card directly from EulaCard instead of downloading its full catalog.
 * The API returns card fields at the top level and accepts all 13 tier codes.
 */
export async function fetchRandomCard(tier) {
  const tierNum = tier == null || String(tier).trim() === ""
    ? pickRandomTier()
    : normalizeTierInput(tier);

  if (!TIER_NAME[tierNum]) {
    const error = new Error(`Unknown card tier: ${tier}`);
    error.code = "CARD_API_DOWN";
    throw error;
  }

  try {
    const url = `${API_RANDOM_BASE}?tier=${encodeURIComponent(tierNum)}`;
    for (let attempt = 0; attempt <= RANDOM_EVENT_RETRIES; attempt += 1) {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(RANDOM_FETCH_TIMEOUT_MS),
      });
      const payload = await response.json();
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `Card API HTTP ${response.status}`);
      }

      const raw = payload?.card || payload?.result || payload?.data || payload;
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.success === false) {
        throw new Error("Unexpected random-card response");
      }
      if (String(raw.event ?? "").trim()) continue;

      const claimId = raw.claimId ?? raw.index ?? raw.id ?? raw.cardId ?? 1;
      return normalise(raw, claimId);
    }

    // The random endpoint includes event-tagged records. Preserve the bot's
    // existing event exclusion if repeated draws keep returning those cards.
    const cards = await fetchAllCards();
    const pool = cards.filter(card => card.tierNum === tierNum);
    if (!pool.length) throw new Error(`No non-event cards found for tier ${tierNum}`);
    return pool[Math.floor(Math.random() * pool.length)];
  } catch (error) {
    const apiError = new Error(
      `Card API is currently unreachable — please try again later. (${error?.message ?? "request failed"})`
    );
    apiError.code = "CARD_API_DOWN";
    throw apiError;
  }
}

export function pickRandomCardFromCatalog(all, random = Math.random) {
  if (!Array.isArray(all) || all.length === 0) return null;
  const pickedNum = pickRandomTier(random);

  const pool = all.filter(c => c.tierNum === pickedNum);
  const available = pool.length ? pool : all;
  return available[Math.floor(random() * available.length)];
}

/**
 * Search cards by name (case-insensitive substring).
 * @param {string} query
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}
 */
export async function searchCards(query, limit = 10) {
  const all = await fetchAllCards();
  const re  = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return all.filter(c => re.test(c.name)).slice(0, limit);
}

/**
 * Find a single card by exact ID or closest name match.
 * @param {string} query  cardId or partial name
 * @returns {Promise<object | null>}
 */
export async function getCard(query) {
  const all = await fetchAllCards();
  const needle = String(query ?? "").trim().toUpperCase();
  // Exact ID
  const byId = all.find(c => c.cardId === needle);
  if (byId) return byId;
  // Short public claim codes are stable across catalog ordering and API IDs.
  const byClaimId = all.find(c => c.claimId === needle);
  if (byClaimId) return byClaimId;
  // Continue to resolve old five-digit IDs already used by earlier bot cards.
  const legacyId = all.find(c => makeId(c.name, c.tierNum) === needle);
  if (legacyId) return legacyId;
  // Exact name (case-insensitive)
  const byName = all.find(c => c.name.toLowerCase() === String(query ?? "").trim().toLowerCase());
  if (byName) return byName;
  // Partial name
  const re = new RegExp(String(query ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  return all.find(c => re.test(c.name)) || null;
}

/**
 * Return all cards of a given tier (by tier code or name).
 * @param {string} tier   "1"–"5" or "Common" etc.
 * @returns {Promise<object[]>}
 */
export async function getCardsByTier(tier) {
  const all    = await fetchAllCards();
  const value  = String(tier ?? "").trim();
  const num    = TIER_NUM[value.toLowerCase()] || TIER_NUM[value.toUpperCase()] || value.toUpperCase();
  return all.filter(c => c.tierNum === num);
}

/**
 * Return a count summary by tier without a full fetch (uses cache if warm,
 * otherwise fetches). Shape: { Common: N, Uncommon: N, ... }
 */
export async function getTierCounts() {
  const all = await fetchAllCards();
  const out = Object.fromEntries(Object.values(TIER_NAME).map(name => [name, 0]));
  for (const c of all) {
    if (out[c.tier] !== undefined) out[c.tier]++;
  }
  return out;
}

/**
 * Pick a card from a specific tier in the cached catalog.
 * @param {string} tier  A tier code or name.
 * @returns {Promise<object|null>}
 */
export async function fetchCardByTier(tier) {
  try {
    return await fetchRandomCard(tier);
  } catch (e) {
    console.error(`[cardApi] fetchCardByTier(${tier}) error:`, e.message);
    return null;
  }
}

function cardVideoPath(url) {
  const id = createHash("sha1").update(`${MEDIA_CACHE_VERSION}:${url}`).digest("hex");
  return join(MEDIA_CACHE_DIR, `${id}.mp4`);
}

function isSecretCard(card) {
  const tier = String(card?.tierNum ?? card?.tier ?? "").trim().toUpperCase();
  return tier === "S" || tier === "SECRET" || tier === "TIER S";
}

/**
 * WhatsApp GIF messages are silent, short MP4 videos with gifPlayback=true.
 * The card API includes animated GIFs and WebPs that can be 10–25 MB. Sending
 * those URLs directly makes WhatsApp show them as heavy image media. Convert
 * them to a compact MP4 before sending.
 */
async function getGifVideo(url) {
  const cached = getCachedMedia(CARD_VIDEO_CACHE, url);
  if (cached) return cached;
  const pending = (async () => {
    const output = join(MEDIA_CACHE_DIR, createHash("sha1").update(MEDIA_CACHE_VERSION + ":video:" + url).digest("hex") + ".mp4");
    if (existsSync(output)) {
      const cached = readFileSync(output);
      if (cached.length > 0) return cached;
      try { unlinkSync(output); } catch {}
    }
    const source = join(MEDIA_CACHE_DIR, createHash("sha1").update(url + ":source").digest("hex") + ".source");
    const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error("Card media HTTP " + response.status);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 20 * 1024 * 1024) throw new Error("Card animation source exceeds 20 MB");
    const sourceBuffer = Buffer.from(await response.arrayBuffer());
    if (!sourceBuffer.length || sourceBuffer.length > 20 * 1024 * 1024) throw new Error("Card animation source exceeds 20 MB");
    writeFileSync(source, sourceBuffer);
    try {
      await execFileAsync(FFMPEG_BIN, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", source,
        "-t", "6",
        "-vf", "fps=10,scale=360:360:force_original_aspect_ratio=decrease,pad=360:360:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p",
        "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "30",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", output,
      ], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
      const video = readFileSync(output);
      if (video.length === 0) throw new Error("FFmpeg produced an empty animated video");
      return video;
    } catch (error) {
      try { unlinkSync(output); } catch {}
      throw error;
    } finally { try { unlinkSync(source); } catch {} }
  })();
  setCachedMedia(CARD_VIDEO_CACHE, url, pending);
  try { return await pending; }
  catch (error) {
    if (CARD_VIDEO_CACHE.get(url) === pending) CARD_VIDEO_CACHE.delete(url);
    throw error;
  }
}

async function getCompactImage(url) {
  const cached = getCachedMedia(CARD_IMAGE_CACHE, url);
  if (cached) return cached;
  const pending = (async () => {
    const hash = createHash("sha1").update(MEDIA_CACHE_VERSION + ":image:" + url).digest("hex");
    const output = join(MEDIA_CACHE_DIR, hash + ".jpg");
    if (existsSync(output)) {
      const cached = readFileSync(output);
      if (cached.length > 0) return cached;
      try { unlinkSync(output); } catch {}
    }
    const source = join(MEDIA_CACHE_DIR, hash + ".source");
    const response = await fetch(url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error("Card image HTTP " + response.status);
    writeFileSync(source, Buffer.from(await response.arrayBuffer()));
    try {
      await execFileAsync(FFMPEG_BIN, [
        "-hide_banner", "-loglevel", "error", "-y", "-i", source,
        "-vf", "scale=960:960:force_original_aspect_ratio=decrease:force_divisible_by=2",
        "-frames:v", "1", "-q:v", "6", output,
      ], { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
      const image = readFileSync(output);
      if (image.length === 0) throw new Error("FFmpeg produced an empty JPEG");
      return image;
    } catch (error) {
      try { unlinkSync(output); } catch {}
      throw error;
    } finally { try { unlinkSync(source); } catch {} }
  })();
  setCachedMedia(CARD_IMAGE_CACHE, url, pending);
  try { return await pending; }
  catch (error) {
    if (CARD_IMAGE_CACHE.get(url) === pending) CARD_IMAGE_CACHE.delete(url);
    throw error;
  }
}

export function getCardMediaKind(card, url = card?.media) {
  return card?.mediaType === "gif"
    || /\.gif(?:$|[?#])/i.test(String(url || ""))
    || ["6", "MYTHICAL"].includes(String(card?.tierNum ?? card?.tier ?? "").trim().toUpperCase())
    || isSecretCard(card)
    ? "animated"
    : "image";
}

/**
 * Send compressed animated or static card media; never pass a large source URL
 * straight to WhatsApp.
 *
 * @param {object} sock     Baileys socket
 * @param {string} jid      Chat JID to send to
 * @param {object} card     Card object (must have .media, .tierNum, .mediaType)
 * @param {string} caption  Caption text
 * @param {object} [extra]  Extra sendMessage options (e.g. { quoted: msg, mentions: [...] })
 */
export async function sendCardMedia(sock, jid, card, caption, extra = {}) {
  const { quoted, ...messageExtra } = extra;
  const send = (payload) => sock.sendMessage(
    jid,
    { ...payload, ...messageExtra },
    quoted ? { quoted } : undefined,
  );
  if (!card.media) return send({ text: caption });
  const url = await resolveMediaUrl(normalizeCardMediaUrl(card.media));
  const fallbackUrls = [...new Set([
    ...(Array.isArray(card.mediaFallbacks) ? card.mediaFallbacks : []),
    card.thumbnail,
    card.thumbnailUrl,
  ].map(normalizeCardMediaUrl).filter(candidate => candidate && candidate !== url))];
  const sendStillFallback = async (candidates, directCandidates = candidates) => {
    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    for (const candidate of uniqueCandidates) {
      try {
        const image = await getCompactImage(candidate);
        return await send({ image, mimetype: "image/jpeg", caption });
      } catch (error) {
        console.error(`[cardApi] Still-image conversion failed for ${candidate}:`, error.message);
      }
    }
    for (const candidate of [...new Set(directCandidates.filter(Boolean))]) {
      try {
        return await send({ image: { url: candidate }, caption });
      } catch (error) {
        console.error(`[cardApi] Direct image delivery failed for ${candidate}:`, error.message);
      }
    }
    return send({ text: caption });
  };
  const isAnimated = getCardMediaKind(card, url) === "animated";
  if (isAnimated) {
    try {
      const video = await getGifVideo(url);
      return send({ video, mimetype: "video/mp4", gifPlayback: true, caption });
    } catch (error) {
      console.error("[cardApi] GIF conversion failed:", error.message);
      return sendStillFallback([...fallbackUrls, url]);
    }
  }
  return sendStillFallback([url, ...fallbackUrls], [...fallbackUrls, url]);
}
