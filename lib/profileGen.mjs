/**
 * KELIN MD — Anime Aesthetic Profile Card
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

let canvasModulePromise;
const PROFILE_FRAME_DIR = fileURLToPath(new URL("../assets/profile-frames/", import.meta.url));
const profileFrameCache = new Map();
const remoteImageCache = new Map();
const remoteImageLoads = new Map();
// Keep the profile photo close to the reference card's scale. Decorative
// frames remain 1.5× the avatar diameter so their edges fit without crowding.
const PROFILE_AVATAR_RADIUS = 165;
const PROFILE_AVATAR_X = 540;
const PROFILE_AVATAR_Y = 285;
const PROFILE_AVATAR_Y_WITH_FRAME = 335;
const REMOTE_IMAGE_CACHE_MS = 5 * 60 * 1000;
const REMOTE_IMAGE_FAILURE_CACHE_MS = 15 * 1000;
const MAX_REMOTE_IMAGE_CACHE_ENTRIES = 24;
const MAX_REMOTE_IMAGE_BYTES = 6 * 1024 * 1024;
const PROFILE_FONT_FAMILIES = {
  arial: "Arial",
  georgia: "Georgia",
  trebuchet: "Trebuchet MS",
  courier: "Courier New",
};

export function normalizeProfileFont(value) {
  const font = String(value || "").trim().toLowerCase();
  return Object.hasOwn(PROFILE_FONT_FAMILIES, font) ? font : "georgia";
}

export function normalizeProfileColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : "#ead8ff";
}

function profileFont(data, weight, size) {
  const family = PROFILE_FONT_FAMILIES[normalizeProfileFont(data.profileFont)];
  return `${weight} ${size}px "${family}"`;
}

function getCanvasModule() {
  if (!canvasModulePromise) {
    canvasModulePromise = import("canvas").catch(async (canvasError) => {
      // Some panel hosts cannot build the native canvas package. The N-API
      // build exposes the same createCanvas/loadImage API without compilation.
      try {
        return await import("@napi-rs/canvas");
      } catch {
        throw canvasError;
      }
    });
  }
  return canvasModulePromise;
}

/**
 * Safely load remote/local images.
 */
async function loadImageSafe(source, timeoutMs = 10000) {
  if (!source) return null;

  try {
    const { loadImage } = await getCanvasModule();

    // Buffer
    if (Buffer.isBuffer(source)) {
      return await loadImage(source);
    }

    if (typeof source === "string") {
      const dataImage = /^data:image\/(?:png|jpe?g|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(source);
      if (dataImage) {
        const buffer = Buffer.from(dataImage[1], "base64");
        if (!buffer.length || buffer.length > MAX_REMOTE_IMAGE_BYTES) {
          throw new Error("Image exceeds the 6 MB profile image limit");
        }
        return await loadImage(buffer);
      }
    }

    // Remote URL
    if (
      typeof source === "string" &&
      /^https?:\/\//i.test(source)
    ) {
      const cached = remoteImageCache.get(source);
      if (cached && cached.expiresAt > Date.now()) {
        remoteImageCache.delete(source);
        remoteImageCache.set(source, cached);
        return cached.image;
      }
      if (cached) remoteImageCache.delete(source);

      const existingLoad = remoteImageLoads.get(source);
      if (existingLoad) return await existingLoad;

      const loadPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(source, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
              "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            },
          });
          if (!response.ok) throw new Error(`Image request failed: ${response.status}`);
          const contentLength = Number(response.headers.get("content-length") || 0);
          if (contentLength > MAX_REMOTE_IMAGE_BYTES) {
            throw new Error("Image exceeds the 6 MB profile image limit");
          }

          const buffer = Buffer.from(await response.arrayBuffer());
          if (!buffer.length) throw new Error("Empty image response");
          if (buffer.length > MAX_REMOTE_IMAGE_BYTES) {
            throw new Error("Image exceeds the 6 MB profile image limit");
          }

          const image = await loadImage(buffer);
          remoteImageCache.set(source, {
            image,
            expiresAt: Date.now() + REMOTE_IMAGE_CACHE_MS,
          });
          while (remoteImageCache.size > MAX_REMOTE_IMAGE_CACHE_ENTRIES) {
            remoteImageCache.delete(remoteImageCache.keys().next().value);
          }
          return image;
        } catch (error) {
          console.warn("[PROFILE IMAGE]", error.message);
          remoteImageCache.set(source, {
            image: null,
            expiresAt: Date.now() + REMOTE_IMAGE_FAILURE_CACHE_MS,
          });
          while (remoteImageCache.size > MAX_REMOTE_IMAGE_CACHE_ENTRIES) {
            remoteImageCache.delete(remoteImageCache.keys().next().value);
          }
          return null;
        } finally {
          clearTimeout(timer);
          remoteImageLoads.delete(source);
        }
      })();
      remoteImageLoads.set(source, loadPromise);
      return await loadPromise;
    }

    return await loadImage(source);
  } catch (error) {
    console.error(
      "[PROFILE IMAGE]",
      error.message
    );

    return null;
  }
}

function normalizeProfileFrameId(frameId) {
  return String(frameId || "").trim().match(/^frame-(0[1-9]|1[0-9]|20)$/)?.[0] || null;
}

async function loadProfileFrame(frameId) {
  const normalized = normalizeProfileFrameId(frameId);
  if (!normalized) return null;
  if (profileFrameCache.has(normalized)) return profileFrameCache.get(normalized);

  const image = await loadImageSafe(join(PROFILE_FRAME_DIR, `${normalized}.png`));
  if (image) profileFrameCache.set(normalized, image);
  return image;
}

export async function getProfileAvatarGeometry(frameId) {
  const hasProfileFrame = Boolean(await loadProfileFrame(frameId));
  const avatarY = hasProfileFrame ? PROFILE_AVATAR_Y_WITH_FRAME : PROFILE_AVATAR_Y;
  return {
    left: PROFILE_AVATAR_X - PROFILE_AVATAR_RADIUS,
    top: avatarY - PROFILE_AVATAR_RADIUS,
    size: PROFILE_AVATAR_RADIUS * 2,
  };
}

function drawProfileFrameOverlay(ctx, profileFrame, avatarRadius, avatarX, avatarY) {
  if (profileFrame) {
    const frameSize = avatarRadius * 2.5;
    drawImageCover(
      ctx,
      profileFrame,
      avatarX - frameSize / 2,
      avatarY - frameSize / 2,
      frameSize,
      frameSize,
    );
    return;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 16, 0, Math.PI * 2);
  ctx.shadowColor = "rgba(201, 157, 255, 0.72)";
  ctx.shadowBlur = 14;
  ctx.strokeStyle = "#ead8ff";
  ctx.lineWidth = 8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 27, 0, Math.PI * 2);
  ctx.shadowBlur = 10;
  ctx.strokeStyle = "#8e6bb5";
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

export async function generateProfileFrameOverlay(data = {}) {
  const { createCanvas } = await getCanvasModule();
  const profileFrame = await loadProfileFrame(data.profileFrame);
  const hasProfileFrame = Boolean(profileFrame);
  const width = 1080;
  const height = hasProfileFrame ? 1160 : 1080;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const avatarRadius = PROFILE_AVATAR_RADIUS;
  const avatarX = PROFILE_AVATAR_X;
  const avatarY = hasProfileFrame ? PROFILE_AVATAR_Y_WITH_FRAME : PROFILE_AVATAR_Y;

  drawProfileFrameOverlay(ctx, profileFrame, avatarRadius, avatarX, avatarY);
  return canvas.toBuffer("image/png");
}

/**
 * Draw image while covering the entire area.
 */
function drawImageCover(
  ctx,
  image,
  x,
  y,
  w,
  h
) {
  if (!image || !image.width || !image.height) {
    return;
  }

  const scale = Math.max(
    w / image.width,
    h / image.height
  );

  const width = image.width * scale;
  const height = image.height * scale;

  ctx.drawImage(
    image,
    x + (w - width) / 2,
    y + (h - height) / 2,
    width,
    height
  );
}

/**
 * Rounded rectangle.
 */
function roundRect(
  ctx,
  x,
  y,
  w,
  h,
  radius
) {
  const r = Math.min(
    radius,
    w / 2,
    h / 2
  );

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(
    x + w,
    y,
    x + w,
    y + h,
    r
  );
  ctx.arcTo(
    x + w,
    y + h,
    x,
    y + h,
    r
  );
  ctx.arcTo(
    x,
    y + h,
    x,
    y,
    r
  );
  ctx.arcTo(
    x,
    y,
    x + w,
    y,
    r
  );
  ctx.closePath();
}

/**
 * Reference-style XP frame with a small centered label notch.
 */
function xpBarPath(
  ctx,
  x,
  y,
  w,
  h,
  notchWidth,
  notchDepth,
) {
  const radius = Math.min(18, h / 2);
  const notchLeft = x + (w - notchWidth) / 2;
  const notchRight = notchLeft + notchWidth;

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(notchRight, y + h);
  ctx.lineTo(notchRight - 16, y + h + notchDepth);
  ctx.lineTo(notchLeft + 16, y + h + notchDepth);
  ctx.lineTo(notchLeft, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

/**
 * Text fitting.
 */
function fitText(
  ctx,
  text,
  maxWidth
) {
  const value =
    String(text ?? "None");

  if (
    ctx.measureText(value).width <=
    maxWidth
  ) {
    return value;
  }

  let output = value;

  while (
    output.length > 3 &&
    ctx.measureText(
      `${output}…`
    ).width > maxWidth
  ) {
    output = output.slice(0, -1);
  }

  return `${output}…`;
}

/**
 * Generate anime aesthetic background
 * when no custom background is available.
 */
function drawAnimeBackground(
  ctx,
  W,
  H
) {
  const gradient =
    ctx.createLinearGradient(
      0,
      0,
      W,
      H
    );

  gradient.addColorStop(
    0,
    "#291333"
  );

  gradient.addColorStop(
    0.35,
    "#18244a"
  );

  gradient.addColorStop(
    0.7,
    "#10172e"
  );

  gradient.addColorStop(
    1,
    "#26132f"
  );

  ctx.fillStyle = gradient;
  ctx.fillRect(
    0,
    0,
    W,
    H
  );

  /*
   * Anime-style moon glow
   */
  const moon =
    ctx.createRadialGradient(
      720,
      180,
      10,
      720,
      180,
      330
    );

  moon.addColorStop(
    0,
    "rgba(255,190,225,0.28)"
  );

  moon.addColorStop(
    0.45,
    "rgba(180,150,255,0.10)"
  );

  moon.addColorStop(
    1,
    "rgba(0,0,0,0)"
  );

  ctx.fillStyle = moon;

  ctx.fillRect(
    400,
    0,
    500,
    500
  );

  /*
   * Stars
   */
  ctx.save();

  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "#ffd9ef";

  const stars = [
    [75, 130, 2],
    [150, 220, 3],
    [245, 95, 2],
    [360, 170, 2],
    [510, 105, 3],
    [620, 240, 2],
    [770, 95, 3],
    [830, 310, 2],
    [90, 520, 2],
    [780, 580, 3],
    [150, 760, 2],
    [700, 820, 2],
    [820, 980, 3],
    [75, 1110, 2],
    [760, 1280, 2],
  ];

  for (const [
    x,
    y,
    size,
  ] of stars) {
    ctx.beginPath();

    ctx.arc(
      x,
      y,
      size,
      0,
      Math.PI * 2
    );

    ctx.fill();
  }

  ctx.restore();

  /*
   * Soft decorative circles
   */
  ctx.save();

  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = "#f5a9d0";
  ctx.lineWidth = 3;

  for (
    let i = 0;
    i < 5;
    i++
  ) {
    ctx.beginPath();

    ctx.arc(
      100 + i * 210,
      300 + i * 180,
      130,
      0,
      Math.PI * 2
    );

    ctx.stroke();
  }

  ctx.restore();

  /*
   * Bottom mist
   */
  const mist =
    ctx.createLinearGradient(
      0,
      H - 400,
      0,
      H
    );

  mist.addColorStop(
    0,
    "rgba(160,100,180,0)"
  );

  mist.addColorStop(
    1,
    "rgba(120,70,150,0.25)"
  );

  ctx.fillStyle = mist;

  ctx.fillRect(
    0,
    H - 400,
    W,
    400
  );
}

/**
 * Get WhatsApp profile picture.
 */
export async function getProfilePic(
  sock,
  jid,
  preferredImage = null
) {
  try {
    if (preferredImage && typeof preferredImage === "string" && /^https?:\/\//i.test(preferredImage)) {
      console.log(`[PROFILE] Using website-selected PFP for ${jid}`);
      return preferredImage;
    }

    if (!sock || !jid) {
      return null;
    }

    const url =
      await sock.profilePictureUrl(
        jid,
        "image"
      );

    if (!url) {
      return null;
    }

    console.log(
      `[PROFILE] PFP found for ${jid}`
    );

    return url;
  } catch (error) {
    console.log(
      `[PROFILE] No PFP for ${jid}: ${error.message}`
    );

    return null;
  }
}

/**
 * Generate profile image.
 */
export async function generateProfileImage(
  data
) {
  const { createCanvas } =
    await getCanvasModule();

  const profileFrame = await loadProfileFrame(data.profileFrame);
  const hasProfileFrame = Boolean(profileFrame);
  const W = 1080;
  const H = hasProfileFrame ? 1160 : 1080;

  const canvas =
    createCanvas(W, H);

  const ctx =
    canvas.getContext("2d");

  // Fetch the custom background and avatar together. The short timeout keeps
  // a slow image host from holding the whole profile command for many seconds.
  const [customBackground, avatar] = await Promise.all([
    data.transparentBackground ? Promise.resolve(null) : loadImageSafe(data.profileBackground, 2500),
    loadImageSafe(data.profileImage, 2500),
  ]);

  /*
   * =========================
   * BACKGROUND
   * =========================
   */

  if (data.transparentBackground) {
    ctx.clearRect(0, 0, W, H);
  } else if (customBackground) {
    drawImageCover(
      ctx,
      customBackground,
      0,
      0,
      W,
      H
    );

    // Keep the uploaded background visible across the entire card. A soft
    // tint improves contrast without creating a separate blank lower panel.
    const backgroundTint = ctx.createLinearGradient(0, 0, 0, H);
    backgroundTint.addColorStop(0, "rgba(10, 6, 20, 0.22)");
    backgroundTint.addColorStop(0.45, "rgba(28, 12, 40, 0.16)");
    backgroundTint.addColorStop(1, "rgba(15, 8, 28, 0.24)");
    ctx.fillStyle = backgroundTint;
    ctx.fillRect(0, 0, W, H);
  } else {
    drawAnimeBackground(
      ctx,
      W,
      H
    );
  }

  /*
   * =========================
   * AVATAR
   * =========================
   */

  const avatarRadius = PROFILE_AVATAR_RADIUS;
  const avatarX = PROFILE_AVATAR_X;
  const avatarY = hasProfileFrame ? PROFILE_AVATAR_Y_WITH_FRAME : PROFILE_AVATAR_Y;

  /*
   * Clean, restrained shadow behind the circular avatar frame.
   */
  ctx.save();
  ctx.shadowColor = "rgba(185, 135, 255, 0.72)";
  ctx.shadowBlur = 22;
  ctx.strokeStyle = "rgba(73, 45, 105, 0.9)";
  ctx.lineWidth = 15;
  ctx.beginPath();
  ctx.arc(avatarX, avatarY, avatarRadius + 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  /*
   * Get PFP
   */

  /*
   * Circular crop
   */

  ctx.save();

  ctx.beginPath();

  ctx.arc(
    avatarX,
    avatarY,
    avatarRadius,
    0,
    Math.PI * 2
  );

  ctx.clip();

  if (avatar) {
    drawImageCover(
      ctx,
      avatar,
      avatarX -
        avatarRadius,
      avatarY -
        avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );
  } else {
    /*
     * Fallback avatar
     */

    const fallback =
      ctx.createLinearGradient(
        avatarX -
          avatarRadius,
        avatarY -
          avatarRadius,
        avatarX +
          avatarRadius,
        avatarY +
          avatarRadius
      );

    fallback.addColorStop(
      0,
      "#5f4a6f"
    );

    fallback.addColorStop(
      1,
      "#1b203c"
    );

    ctx.fillStyle =
      fallback;

    ctx.fillRect(
      avatarX -
        avatarRadius,
      avatarY -
        avatarRadius,
      avatarRadius * 2,
      avatarRadius * 2
    );

    ctx.fillStyle =
      "#ffffff";

    ctx.font =
      "bold 80px Sans";

    ctx.textAlign =
      "center";

    ctx.textBaseline =
      "middle";

    ctx.fillText(
      (
        data.username ||
        "?"
      )[0].toUpperCase(),
      avatarX,
      avatarY
    );
  }

  ctx.restore();

  const frameSize = hasProfileFrame ? avatarRadius * 2.5 : (avatarRadius + 27) * 2;
  drawProfileFrameOverlay(ctx, profileFrame, avatarRadius, avatarX, avatarY);

  /*
   * =========================
   * USERNAME
   * =========================
   */

  const username =
    String(
      data.username ||
        "User"
    ).trim() ||
    "User";

  // Text starts below the circular frame with a deliberate visual buffer.
  const usernameY = avatarY + (hasProfileFrame ? frameSize / 2 : avatarRadius) + 72;
  const themeColor = normalizeProfileColor(data.profileColor);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = themeColor;
  ctx.shadowColor = "rgba(12, 4, 20, 0.88)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.font = profileFont(data, "bold", 54);
  ctx.fillText(fitText(ctx, username.toUpperCase(), 880), W / 2, usernameY);

  const roleText = String(data.role || "Member").toUpperCase();
  const roleLabel = roleText === "MODERATOR" ? "MOD" : roleText;
  const level = Math.max(1, Number(data.level) || 1);
  const currentXp = Math.max(0, Number(data.xp) || 0);
  const targetXp = Math.max(1, Number(data.xpTarget) || 100);
  const progress = Math.min(currentXp / targetXp, 1);

  ctx.fillStyle = themeColor;
  ctx.font = profileFont(data, "bold", 31);
  ctx.fillText(
    fitText(ctx, `${roleLabel}   ✤   ${data.levelRole?.name || "Newcomer"}`, 880),
    W / 2,
    usernameY + 54,
  );

  const barX = 270;
  const barY = usernameY + 90;
  const barW = W - 540;
  const barH = 44;
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  xpBarPath(ctx, barX, barY, barW, barH, 190, 34);
  ctx.fillStyle = "rgba(10, 4, 20, 0.6)";
  ctx.fill();
  ctx.save();
  ctx.shadowColor = `${themeColor}cc`;
  ctx.shadowBlur = 18;
  ctx.strokeStyle = themeColor;
  ctx.lineWidth = 5;
  xpBarPath(ctx, barX, barY, barW, barH, 190, 34);
  ctx.stroke();
  ctx.restore();

  const innerBarX = barX + 18;
  const innerBarY = barY + 13;
  const innerBarW = barW - 36;
  const innerBarH = 18;
  ctx.fillStyle = "rgba(32, 15, 48, 0.78)";
  roundRect(ctx, innerBarX, innerBarY, innerBarW, innerBarH, 9);
  ctx.fill();
  if (progress > 0) {
    ctx.fillStyle = themeColor;
    roundRect(ctx, innerBarX, innerBarY, Math.max(innerBarH, innerBarW * progress), innerBarH, 9);
    ctx.fill();
  }
  ctx.fillStyle = themeColor;
  ctx.font = profileFont(data, "bold", 23);
  ctx.fillText(
    `Lv.${level}   •   ${currentXp.toLocaleString()} / ${targetXp.toLocaleString()} XP`,
    W / 2,
    barY + barH + 31,
  );

  const guildName = String(data.guild || "No guild").trim() || "No guild";
  const joinedDate = String(data.joined || "Unknown").trim() || "Unknown";

  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(12, 4, 20, 0.88)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = themeColor;
  ctx.font = profileFont(data, "bold italic", 37);
  ctx.fillText(`☆${fitText(ctx, guildName.toUpperCase(), 880)}☆`, W / 2, barY + 135);

  ctx.fillStyle = themeColor;
  ctx.font = profileFont(data, "italic", 28);
  ctx.fillText(`Joined ${fitText(ctx, joinedDate, 820)}`, W / 2, barY + 182);

  ctx.fillStyle = themeColor;
  ctx.font = profileFont(data, "bold italic", 29);
  ctx.fillText(`“${fitText(ctx, data.bio || "No bio set.", 880)}”`, W / 2, barY + 248);

  return canvas.toBuffer("image/png");
}

/**
 * Resolve the account/staff role shown on the profile card.
 */
export function resolveRole({ isOwner, isMod, isStaff, isPremium, staffLevel = 0 }) {
  if (isOwner || Number(staffLevel) >= 3) return "Owner";
  if (isMod) return "Moderator";
  if (isStaff || staffLevel >= 2) return "Staff";
  if (isPremium) return "Premium";
  return "Member";
}