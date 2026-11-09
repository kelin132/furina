import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  generateProfileFrameOverlay,
  generateProfileImage,
  getProfileAvatarGeometry,
} from "./profileGen.mjs";

const execFileAsync = promisify(execFile);
const FFMPEG_BIN = process.env.FFMPEG_PATH || "ffmpeg";
const MAX_PROFILE_MEDIA_BYTES = 10 * 1024 * 1024;
const PROFILE_MEDIA_CACHE_MS = 2 * 60 * 1000;
const PROFILE_CARD_CACHE_MS = 20 * 1000;
const MAX_PROFILE_MEDIA_CACHE_ENTRIES = 3;
const MAX_PROFILE_CARD_CACHE_ENTRIES = 5;
const PROFILE_CARD_VIDEO_SECONDS = 4;
const PROFILE_CARD_FPS = 10;
const profileMediaCache = new Map();
const profileMediaLoads = new Map();
const profileCardCache = new Map();
const profileCardLoads = new Map();

function getCached(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  cache.delete(key);
  cache.set(key, entry);
  return entry.value;
}

function putCached(cache, key, value, ttlMs, maxEntries) {
  cache.delete(key);
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
}

async function loadProfileAnimation(source) {
  const cached = getCached(profileMediaCache, source);
  if (cached) return cached;

  const inFlight = profileMediaLoads.get(source);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const url = new URL(source);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Profile animation URL must use HTTP or HTTPS.");
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(12_000),
      headers: { Accept: "image/gif,video/mp4,*/*;q=0.5" },
    });
    if (!response.ok) throw new Error(`Profile animation request failed (${response.status}).`);

    const declaredLength = Number(response.headers.get("content-length")) || 0;
    if (declaredLength > MAX_PROFILE_MEDIA_BYTES) {
      throw new Error("Profile animation exceeds the 10 MB limit.");
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_PROFILE_MEDIA_BYTES) {
      throw new Error("Profile animation exceeds the 10 MB limit.");
    }

    const signature = buffer.subarray(0, 6).toString("ascii");
    const contentType = signature === "GIF87a" || signature === "GIF89a"
      ? "image/gif"
      : buffer.subarray(4, 8).toString("ascii") === "ftyp"
        ? "video/mp4"
        : null;
    if (!contentType) throw new Error("Profile animation must be a GIF or MP4.");

    const result = { buffer, contentType };
    putCached(profileMediaCache, source, result, PROFILE_MEDIA_CACHE_MS, MAX_PROFILE_MEDIA_CACHE_ENTRIES);
    return result;
  })();

  profileMediaLoads.set(source, pending);
  try {
    return await pending;
  } finally {
    profileMediaLoads.delete(source);
  }
}

function profileCardCacheKey(data, sources) {
  return createHash("sha256")
    .update(JSON.stringify(sources))
    .update(JSON.stringify(data))
    .digest("hex");
}

async function renderProfileCardVideo(data, sources) {
  const [avatarAnimation, backgroundAnimation] = await Promise.all([
    sources.avatarSource ? loadProfileAnimation(sources.avatarSource) : null,
    sources.backgroundSource ? loadProfileAnimation(sources.backgroundSource) : null,
  ]);
  const [profileCard, frameOverlay, avatar] = await Promise.all([
    generateProfileImage({
      ...data,
      transparentBackground: Boolean(backgroundAnimation),
      profileImage: avatarAnimation ? null : data.profileImage,
    }),
    generateProfileFrameOverlay(data),
    getProfileAvatarGeometry(data.profileFrame),
  ]);
  const workDir = await mkdtemp(join(tmpdir(), "aidoru-profile-"));
  const cardPath = join(workDir, "profile-card.png");
  const avatarPath = avatarAnimation
    ? join(workDir, avatarAnimation.contentType === "image/gif" ? "avatar.gif" : "avatar.mp4")
    : null;
  const backgroundPath = backgroundAnimation
    ? join(workDir, backgroundAnimation.contentType === "image/gif" ? "background.gif" : "background.mp4")
    : null;
  const framePath = join(workDir, "profile-frame.png");
  const outputPath = join(workDir, "profile-card.mp4");

  try {
    const writes = [
      writeFile(cardPath, profileCard),
      writeFile(framePath, frameOverlay),
    ];
    if (avatarAnimation && avatarPath) writes.push(writeFile(avatarPath, avatarAnimation.buffer));
    if (backgroundAnimation && backgroundPath) writes.push(writeFile(backgroundPath, backgroundAnimation.buffer));
    await Promise.all(writes);

    const ffmpegArgs = [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
    ];
    let nextInputIndex = 0;
    const backgroundIndex = nextInputIndex++;
    if (backgroundAnimation && backgroundPath) {
      ffmpegArgs.push("-stream_loop", "-1", "-i", backgroundPath);
    } else {
      ffmpegArgs.push("-loop", "1", "-framerate", String(PROFILE_CARD_FPS), "-i", cardPath);
    }
    let foregroundIndex = null;
    if (backgroundAnimation) {
      foregroundIndex = nextInputIndex++;
      ffmpegArgs.push("-loop", "1", "-framerate", String(PROFILE_CARD_FPS), "-i", cardPath);
    }
    let avatarIndex = null;
    if (avatarAnimation && avatarPath) {
      avatarIndex = nextInputIndex++;
      ffmpegArgs.push("-stream_loop", "-1", "-i", avatarPath);
    }
    const frameIndex = nextInputIndex;
    ffmpegArgs.push("-loop", "1", "-framerate", String(PROFILE_CARD_FPS), "-i", framePath);

    const filters = [];
    let composite = "base";
    if (backgroundAnimation && foregroundIndex !== null) {
      filters.push(
        `[${backgroundIndex}:v]fps=${PROFILE_CARD_FPS},scale=1080:1080:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=1080:1080,setsar=1[bg]`,
      );
      filters.push(`[bg][${foregroundIndex}:v]overlay=0:0:eof_action=repeat:shortest=0:format=auto[base]`);
    } else {
      filters.push(`[${backgroundIndex}:v]format=rgba[base]`);
    }
    if (avatarIndex !== null) {
      filters.push(
        `[${avatarIndex}:v]fps=${PROFILE_CARD_FPS},scale=${avatar.size}:${avatar.size}:force_original_aspect_ratio=increase:flags=fast_bilinear,crop=${avatar.size}:${avatar.size},setsar=1,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='min(alpha(X,Y),clip(230.5-sqrt(pow(X-229.5,2)+pow(Y-229.5,2)),0,1)*255)'[circle]`,
      );
      filters.push(`[${composite}][circle]overlay=${avatar.left}:${avatar.top}:eof_action=repeat:shortest=0:format=auto[withavatar]`);
      composite = "withavatar";
    }
    filters.push(`[${composite}][${frameIndex}:v]overlay=0:0:eof_action=repeat:shortest=0:format=auto,fps=${PROFILE_CARD_FPS},scale=640:-2:flags=fast_bilinear,format=yuv420p[out]`);
    ffmpegArgs.push(
      "-filter_complex", filters.join(";"),
      "-map", "[out]",
      "-an",
      "-t", String(PROFILE_CARD_VIDEO_SECONDS),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "30",
      "-threads", "2",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      outputPath,
    );
    await execFileAsync(FFMPEG_BIN, ffmpegArgs, { timeout: 20_000, maxBuffer: 2 * 1024 * 1024 });

    const video = await readFile(outputPath);
    if (!video.length) throw new Error("Profile video renderer produced an empty file.");
    return video;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export async function generateAnimatedProfileCard(data, sourceOrSources) {
  const sources = typeof sourceOrSources === "string"
    ? { avatarSource: sourceOrSources, backgroundSource: null }
    : {
        avatarSource: sourceOrSources?.avatarSource || null,
        backgroundSource: sourceOrSources?.backgroundSource || null,
      };
  if (!sources.avatarSource && !sources.backgroundSource) {
    throw new Error("A moving avatar or background is required.");
  }
  const cacheKey = profileCardCacheKey(data, sources);
  const cached = getCached(profileCardCache, cacheKey);
  if (cached) return cached;

  const inFlight = profileCardLoads.get(cacheKey);
  if (inFlight) return inFlight;

  const pending = renderProfileCardVideo(data, sources).then((video) => {
    putCached(profileCardCache, cacheKey, video, PROFILE_CARD_CACHE_MS, MAX_PROFILE_CARD_CACHE_ENTRIES);
    return video;
  });
  profileCardLoads.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    profileCardLoads.delete(cacheKey);
  }
}
