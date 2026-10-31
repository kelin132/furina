/**
 * KELIN MD — Pokémon battle canvas renderer
 * Classic GBA-style Pokémon battle screen with HP bars, sprites, and effects.
 */
import { getPokemonXpNeeded } from "./pokemonDb.mjs";
import { BATTLEFIELDS } from "./battlefields.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const battlefieldImageCache = new Map();
const spriteOpaqueBoundsCache = new WeakMap();

let canvasModulePromise;

async function getCanvasModule() {
  canvasModulePromise ??= import("canvas");
  return canvasModulePromise;
}

async function loadImageSafe(url, label = "pokemon") {
  if (!url) return null;
  try {
    const { loadImage } = await getCanvasModule();
    if (!/^https?:\/\//i.test(url)) {
      const filePath = url.startsWith("file://") ? fileURLToPath(url) : url;
      return await loadImage(await readFile(filePath));
    }
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (KelinMD-Bot)" },
    });
    if (!res.ok) return null;
    return await loadImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Try multiple URLs in order, return first that loads successfully */
async function loadImageWithFallbacks(urls, label = "pokemon") {
  for (const url of urls) {
    if (!url) continue;
    const img = await loadImageSafe(url, label);
    if (img) return img;
  }
  return null;
}

function getBattleSpriteUrls(pokemon, useBackSprite) {
  const id = Number(pokemon?.pokedexId);
  const urls = [];

  // Always prefer the classic pixel sprites for battle scenes. Stored Pokémon
  // records may still have official-artwork URLs, so derive the sprite URL
  // from the Pokédex ID instead of trusting an older imageUrl field.
  if (Number.isInteger(id) && id > 0) {
    if (useBackSprite) {
      urls.push(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`);
    }
    urls.push(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`);
  }

  urls.push(
    useBackSprite ? pokemon?.backImageLocalPath : pokemon?.imageLocalPath,
    useBackSprite ? pokemon?.backSpriteUrl : pokemon?.frontSpriteUrl,
    useBackSprite ? pokemon?.backImageUrl : null,
    pokemon?.imageUrl,
    pokemon?.fallbackImageUrl
  );

  return [...new Set(urls)].filter(Boolean);
}

async function loadBattleSprite(pokemon, useBackSprite) {
  for (const url of getBattleSpriteUrls(pokemon, useBackSprite)) {
    const image = await loadImageSafe(url, pokemon?.name);
    if (!image) continue;
    const sourceIsBackSprite =
      /\/back(?:-shiny)?\//i.test(url) ||
      (useBackSprite && [
        pokemon?.backImageLocalPath,
        pokemon?.backSpriteUrl,
        pokemon?.backImageUrl,
      ].includes(url));
    return {
      image,
      // PokeAPI front sprites face left; backs face right. Mirror fallbacks so
      // the player and opponent always look toward one another.
      flip: useBackSprite ? !sourceIsBackSprite : sourceIsBackSprite,
    };
  }
  return { image: null, flip: false };
}

function getVisibleSpriteBounds(image, createCanvas) {
  const cached = spriteOpaqueBoundsCache.get(image);
  if (cached) return cached;

  let bounds = { x: 0, y: 0, width: image.width, height: image.height };
  try {
    const probe = createCanvas(image.width, image.height);
    const probeContext = probe.getContext("2d");
    probeContext.drawImage(image, 0, 0);
    const pixels = probeContext.getImageData(0, 0, image.width, image.height).data;
    let left = image.width;
    let top = image.height;
    let right = -1;
    let bottom = -1;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        if (pixels[(y * image.width + x) * 4 + 3] <= 8) continue;
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    if (right >= left && bottom >= top) {
      bounds = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
    }
  } catch {
    // If a source cannot be inspected, contain the full image and keep it grounded.
  }
  spriteOpaqueBoundsCache.set(image, bounds);
  return bounds;
}

function drawBattleSprite(ctx, image, centerX, footY, maxWidth, maxHeight, flip = false, createCanvas) {
  if (!image) return null;
  const bounds = getVisibleSpriteBounds(image, createCanvas);
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const drawWidth = bounds.width * scale;
  const drawHeight = bounds.height * scale;
  const drawX = centerX - drawWidth / 2;
  const drawY = footY - drawHeight;

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.translate(centerX, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(
      image,
      bounds.x, bounds.y, bounds.width, bounds.height,
      -drawWidth / 2, drawY, drawWidth, drawHeight,
    );
  } else {
    ctx.drawImage(
      image,
      bounds.x, bounds.y, bounds.width, bounds.height,
      drawX, drawY, drawWidth, drawHeight,
    );
  }
  ctx.restore();
  return { x: drawX, y: drawY, width: drawWidth, height: drawHeight };
}

function roundRect(ctx, x, y, w, h, r = 8) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function hpColor(pct) {
  if (pct > 0.5) return "#30e858";
  if (pct > 0.2) return "#f7d02c";
  return "#f34444";
}

function drawHPBox(ctx, x, y, w, name, level, hp, maxHp, shiny = false) {
  // Box background
  roundRect(ctx, x, y, w, 80, 8);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Name
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 18px Sans";
  ctx.textAlign = "left";
  ctx.fillText(name + (shiny ? " ⭐" : ""), x + 10, y + 22);

  // Level
  ctx.font = "14px Sans";
  ctx.fillStyle = "#444";
  ctx.textAlign = "right";
  ctx.fillText(`Lv.${level}`, x + w - 10, y + 22);

  // HP label
  ctx.fillStyle = "#1a1a1a";
  ctx.font = "bold 13px Sans";
  ctx.textAlign = "left";
  ctx.fillText("HP", x + 10, y + 44);

  // HP bar background
  const barX = x + 32, barY = y + 34, barW = w - 50, barH = 10;
  roundRect(ctx, barX, barY, barW, barH, 5);
  ctx.fillStyle = "#c8c8c8";
  ctx.fill();

  // HP bar fill
  const pct = Math.max(0, Math.min(1, hp / maxHp));
  if (pct > 0) {
    roundRect(ctx, barX, barY, barW * pct, barH, 5);
    ctx.fillStyle = hpColor(pct);
    ctx.fill();
  }

  // HP numbers
  ctx.fillStyle = "#333";
  ctx.font = "13px Sans";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.max(0, hp)}/${maxHp}`, x + w - 10, y + 68);
}

// ── Arena helpers (premium stadium aesthetic) ────────────────────────────────

function typeColor(type) {
  const colors = {
    normal:"#a8a878", fire:"#f08030", water:"#6890f0", grass:"#78c850",
    electric:"#f8d030", ice:"#98d8d8", fighting:"#c03028", poison:"#a040a0",
    ground:"#e0c068", flying:"#a890f0", psychic:"#f85888", bug:"#a8b820",
    rock:"#b8a038", ghost:"#705898", dragon:"#7038f8", dark:"#705848",
    steel:"#b8b8d0", fairy:"#ee99ac",
  };
  return colors[type?.toLowerCase()] || "#808080";
}

/** Small deterministic pseudo-random generator so the crowd/stars pattern doesn't jitter frame to frame. */
function seededRand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Row of soft scalloped stadium seating along the horizon, receding into haze. */
function drawCrowdSilhouette(ctx, W, horizonY, rows = 3) {
  const rand = seededRand(42);
  for (let r = 0; r < rows; r++) {
    const rowY = horizonY - 34 - r * 22;
    const scallop = 26 - r * 4;
    const alpha = 0.16 - r * 0.04;
    ctx.fillStyle = `rgba(10,14,30,${Math.max(0.04, alpha)})`;
    ctx.beginPath();
    ctx.moveTo(0, rowY + scallop);
    for (let x = 0; x <= W + scallop; x += scallop) {
      const bob = (rand() - 0.5) * 6;
      ctx.arc(x, rowY + bob, scallop / 2, Math.PI, 0);
    }
    ctx.lineTo(W, rowY + scallop);
    ctx.closePath();
    ctx.fill();
  }
}

/** Faint twinkling light specks scattered in the upper sky. */
function drawSkySparkles(ctx, W, H, count = 26) {
  const rand = seededRand(7);
  ctx.save();
  for (let i = 0; i < count; i++) {
    const x = rand() * W;
    const y = rand() * H * 0.4;
    const r = rand() * 1.4 + 0.3;
    ctx.globalAlpha = rand() * 0.35 + 0.08;
    ctx.fillStyle = "#ffe9a8";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Concentric glowing rings marking the arena floor, drawn in perspective as ellipses. */
function drawArenaRings(ctx, W, H) {
  const cx = W / 2, cy = H * 0.5;
  for (let i = 0; i < 3; i++) {
    const rw = W * (0.62 + i * 0.16);
    const rh = 46 + i * 20;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rw / 2, rh, 0, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(120,175,255,${0.14 - i * 0.035})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

/**
 * Draw a simple Pokémon-silhouette placeholder when a sprite fails to load.
 * Canvas cannot render emoji glyphs — this replaces the broken emoji fallback.
 */
function drawPokemonPlaceholder(ctx, cx, cy, r, color = "#888") {
  ctx.save();
  // Body circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color + "55";
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Eyes
  const eyeY = cy - r * 0.2;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(cx - r * 0.25, eyeY, r * 0.10, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(cx + r * 0.25, eyeY, r * 0.10, 0, Math.PI * 2); ctx.fill();
  // Question mark label
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(r * 0.55)}px Sans`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("?", cx, cy + r * 0.22);
  ctx.restore();
}

/** Elliptical ground shadow directly beneath a fighter, grounding the sprite. */
function drawGroundShadow(ctx, cx, footY, rx) {
  const g = ctx.createRadialGradient(cx, footY, 2, cx, footY, rx);
  g.addColorStop(0, "rgba(0,0,0,0.42)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(cx, footY, rx, rx * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * FireRed battle back sheets are 64px wide and contain five 64px animation
 * frames stacked vertically. Their first frame is intentionally cropped at
 * the waist. Full-body trainer assets are already a single 64x64 frame and
 * must be rendered without applying the battle-sheet crop.
 */
function drawTrainerSprite(ctx, image, x, y, size, { flip = false, fullBody = false } = {}) {
  if (!image) return;
  const sourceWidth = fullBody ? image.width : Math.min(image.width, image.height);
  const sourceHeight = fullBody ? image.height : sourceWidth;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flip) {
    ctx.translate(x + size, y);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, 0, 0, size, size);
  } else {
    ctx.drawImage(image, 0, 0, sourceWidth, sourceHeight, x, y, size, size);
  }
  ctx.restore();
}

/** Bright, striped GBA-style field based on the uploaded battle reference. */
function drawArenaBackground(ctx, W, H) {
  ctx.fillStyle = "#dff4e8";
  ctx.fillRect(0, 0, W, H);

  // Even horizontal scanline bands replace the old dark stadium treatment.
  for (let y = 0; y < H; y += 18) {
    ctx.fillStyle = y < H * 0.48
      ? (y % 36 === 0 ? "#b8dfea" : "#d7edf1")
      : (y % 36 === 0 ? "#c1e8c9" : "#d8f2d6");
    ctx.fillRect(0, y, W, 9);
  }

  const horizon = ctx.createLinearGradient(0, H * 0.30, 0, H * 0.62);
  horizon.addColorStop(0, "rgba(255,255,255,0.28)");
  horizon.addColorStop(0.55, "rgba(231,250,222,0.32)");
  horizon.addColorStop(1, "rgba(185,232,179,0)");
  ctx.fillStyle = horizon;
  ctx.fillRect(0, H * 0.2, W, H * 0.52);
}

function loadBattlefieldImage(arenaId) {
  const key = Object.hasOwn(BATTLEFIELDS, arenaId) ? arenaId : "meadow";
  const arena = BATTLEFIELDS[key];
  if (!battlefieldImageCache.has(key)) {
    battlefieldImageCache.set(key, loadImageSafe(arena.imagePath, `${key} battlefield`));
  }
  return battlefieldImageCache.get(key);
}

function drawCoverImage(ctx, image, W, H) {
  const scale = Math.max(W / image.width, H / image.height);
  const sourceWidth = W / scale;
  const sourceHeight = H / scale;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  ctx.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, W, H);
}

function drawRetroMessageBox(ctx, text, W) {
  if (!text) return;
  const boxX = 16;
  const boxY = 16;
  const boxW = Math.min(610, W * 0.56);
  const boxH = 112;

  ctx.save();
  ctx.fillStyle = "#fffde5";
  ctx.strokeStyle = "#111820";
  ctx.lineWidth = 4;
  roundRect(ctx, boxX, boxY, boxW, boxH, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#111820";
  ctx.font = "26px monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const message = text.substring(0, 58);
  const lines = [];
  let current = "";
  for (const word of message.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > boxW - 38 && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  lines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, boxX + 20, boxY + 42 + index * 34);
  });
  ctx.restore();
}

/** Rounded rect with a soft drop shadow, gradient panel fill, and a colored top accent strip. */
function drawArenaHPBox(ctx, x, y, w, name, level, hp, maxHp, shiny, primaryType) {
  const accent = primaryType ? typeColor(primaryType) : "#2244aa";
  const boxH = 88;

  // Drop shadow
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, boxH, 12);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fill();
  ctx.restore();

  // Panel gradient (subtle sheen top-to-bottom)
  const panel = ctx.createLinearGradient(x, y, x, y + boxH);
  panel.addColorStop(0, "rgba(255,255,255,0.98)");
  panel.addColorStop(1, "rgba(235,238,245,0.94)");
  roundRect(ctx, x, y, w, boxH, 12);
  ctx.fillStyle = panel;
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Type-colored top accent strip with gradient
  const strip = ctx.createLinearGradient(x, y, x + w, y);
  strip.addColorStop(0, accent);
  strip.addColorStop(1, "rgba(255,255,255,0.25)");
  roundRect(ctx, x, y, w, 8, 12);
  ctx.fillStyle = strip;
  ctx.fill();

  // Name
  ctx.fillStyle = "#111";
  ctx.font = "bold 18px Sans";
  ctx.textAlign = "left";
  ctx.fillText((name + (shiny ? " ✨" : "")).substring(0, 22), x + 12, y + 30);

  // Level badge (small pill, top-right)
  const lvlLabel = `Lv.${level}`;
  ctx.font = "bold 13px Sans";
  const lvlW = ctx.measureText(lvlLabel).width + 16;
  roundRect(ctx, x + w - lvlW - 10, y + 16, lvlW, 20, 10);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText(lvlLabel, x + w - lvlW / 2 - 10, y + 30);

  // HP label
  ctx.fillStyle = "#333";
  ctx.font = "bold 12px Sans";
  ctx.textAlign = "left";
  ctx.fillText("HP", x + 12, y + 52);

  // HP bar track
  const barX = x + 34, barY = y + 42, barW = w - 48, barH = 12;
  roundRect(ctx, barX, barY, barW, barH, 6);
  ctx.fillStyle = "#d5d5da";
  ctx.fill();
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.25)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  roundRect(ctx, barX, barY, barW, barH, 6);
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // HP bar fill with color + glossy highlight
  const pct = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
  if (pct > 0) {
    const fillColor = hpColor(pct);
    roundRect(ctx, barX, barY, barW * pct, barH, 6);
    ctx.fillStyle = fillColor;
    ctx.fill();
    // Glossy top half highlight
    roundRect(ctx, barX, barY, barW * pct, barH / 2, 6);
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.fill();
  }
  // Quarter tick marks
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  for (let t = 1; t < 4; t++) {
    const tx = barX + (barW * t) / 4;
    ctx.beginPath();
    ctx.moveTo(tx, barY + 1);
    ctx.lineTo(tx, barY + barH - 1);
    ctx.stroke();
  }

  // HP numbers
  ctx.fillStyle = "#222";
  ctx.font = "bold 12px Sans";
  ctx.textAlign = "right";
  ctx.fillText(`${Math.max(0, hp)}/${maxHp}`, x + w - 10, y + 74);
}

/**
 * Draw the main battle scene — stadium arena with both Pokémon facing each other.
 * @param {object} opts
 * @param {object} opts.player  { name, level, hp, maxHp, imageUrl, shiny, primaryType, trainer }
 * @param {object} opts.enemy   { name, level, hp, maxHp, imageUrl, shiny, primaryType, trainer }
 * @param {number} [opts.round]
 * @param {"player"|"enemy"|null} [opts.hitSide]
 * @param {number} [opts.damage]
 * @param {boolean} [opts.crit]
 * @param {string} [opts.statusText]
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generateBattleScene({ player, enemy, round = 1, arenaId = "meadow", hitSide = null, damage = null, crit = false, statusText = "" }) {
  const { createCanvas } = await getCanvasModule();
  const W = 1100, H = 600;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const arena = Object.hasOwn(BATTLEFIELDS, arenaId) ? BATTLEFIELDS[arenaId] : BATTLEFIELDS.meadow;

  const battlefieldImage = await loadBattlefieldImage(arenaId);
  if (battlefieldImage) {
    drawCoverImage(ctx, battlefieldImage, W, H);
  } else {
    drawArenaBackground(ctx, W, H);
  }
  // Hit flash overlay
  if (hitSide === "player") {
    ctx.fillStyle = "rgba(255,40,40,0.22)";
    ctx.fillRect(0, H * 0.45, W * 0.5, H);
  }
  if (hitSide === "enemy") {
    ctx.fillStyle = "rgba(255,40,40,0.22)";
    ctx.fillRect(W * 0.5, 0, W * 0.5, H * 0.55);
  }

  // Load classic 2D pixel sprites in parallel. The local player uses a back
  // sprite and the opponent uses a front sprite, matching the perspective of
  // a Pokémon battle screen.
  const [playerSprite, enemySprite] = await Promise.all([
    loadBattleSprite(player, true),
    loadBattleSprite(enemy, false),
  ]);
  const playerImg = playerSprite.image;
  const enemyImg = enemySprite.image;
  const [playerTrainerImg, enemyTrainerImg] = await Promise.all([
    loadImageSafe(player.trainer?.imagePath, "player trainer"),
    loadImageSafe(enemy.trainer?.imagePath, "opponent trainer"),
  ]);

  // ── ENEMY sprite — top-right platform, flipped to face LEFT toward player ──
  const enemySize = 240;
  const enemyCX   = W * arena.enemy.x;
  const enemyFootY = H * arena.enemy.footY;
  const enemyX = enemyCX - enemySize / 2;
  const enemyY = enemyFootY - enemySize;

  drawGroundShadow(ctx, enemyCX, enemyFootY + 6, 100);

  let enemyDrawn = null;
  if (enemyImg) {
    enemyDrawn = drawBattleSprite(ctx, enemyImg, enemyCX, enemyFootY, 230, 220, enemySprite.flip, createCanvas);
  } else {
    // Draw a simple Pokemon-ball silhouette placeholder (no emoji — canvas can't render them)
    drawPokemonPlaceholder(ctx, enemyX + enemySize / 2, enemyY + enemySize / 2, enemySize * 0.38, "#cc4444");
  }

  // Wild encounters have no opposing trainer. In trainer battles, the
  // FireRed front-facing sprite is drawn at full standing height beside the
  // enemy Pokémon, already oriented toward the player-side Pokémon.
  if (enemyTrainerImg) {
    const enemyTrainerSize = 190;
    const enemyTrainerX = Math.min(W - enemyTrainerSize - 18, enemyX + enemySize - 10);
    const enemyTrainerY = enemyFootY - enemyTrainerSize + 8;
    drawGroundShadow(ctx, enemyTrainerX + enemyTrainerSize / 2, enemyFootY + 6, 58);
    drawTrainerSprite(ctx, enemyTrainerImg, enemyTrainerX, enemyTrainerY, enemyTrainerSize, {
      fullBody: enemy.trainer?.fullBody,
    });
  }

  // ── PLAYER sprite — bottom-left platform, faces RIGHT toward enemy ──
  const playerSize = 260;
  const playerCX   = W * arena.player.x;
  const playerFootY = H * arena.player.footY;
  const playerX = playerCX - playerSize / 2;
  const playerY = playerFootY - playerSize;

  drawGroundShadow(ctx, playerCX, playerFootY + 8, 124);

  let playerDrawn = null;
  if (playerImg) {
    // PokeAPI back sprites are already composed for the trainer's side.
    playerDrawn = drawBattleSprite(ctx, playerImg, playerCX, playerFootY, 250, 245, playerSprite.flip, createCanvas);
  } else {
    // Draw a simple placeholder (no emoji — canvas can't render emoji glyphs)
    drawPokemonPlaceholder(ctx, playerX + playerSize / 2, playerY + playerSize / 2, playerSize * 0.38, "#44aacc");
  }

  // Local trainer uses the composed full-body FireRed sprite and stands beside
  // (not underneath) the player's Pokémon. It is already oriented for the
  // trainer side, so it must not be mirrored.
  const playerTrainerSize = 190;
  const playerTrainerX = Math.max(16, playerX - playerTrainerSize - 6);
  const playerTrainerY = playerFootY - playerTrainerSize + 8;
  drawGroundShadow(ctx, playerTrainerX + playerTrainerSize / 2, playerFootY + 6, 58);
  drawTrainerSprite(ctx, playerTrainerImg, playerTrainerX, playerTrainerY, playerTrainerSize, {
    // Full-body player assets use the coherent FireRed front portrait. Mirror
    // that complete drawing so the trainer faces into the battle arena.
    flip: player.trainer?.fullBody,
    fullBody: player.trainer?.fullBody,
  });

  // ── HP boxes ──────────────────────────────────────────────────────────────
  // Keep the dialogue area clear, like the reference image.
  drawArenaHPBox(ctx, 12, 142, 290, enemy.name, enemy.level, enemy.hp, enemy.maxHp, enemy.shiny, enemy.primaryType);
  // Player box — bottom-right
  drawArenaHPBox(ctx, W - 308, H - 100, 294, player.name, player.level, player.hp, player.maxHp, player.shiny, player.primaryType);

  // ── Round badge (top center) — gradient pill with side ornament ticks ────
  const badgeW = 156, badgeH = 42, badgeX = W / 2 - badgeW / 2, badgeY = 12;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.5)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 3;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 21);
  const badgeGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX, badgeY + badgeH);
  badgeGrad.addColorStop(0, "rgba(30,20,0,0.85)");
  badgeGrad.addColorStop(1, "rgba(0,0,0,0.75)");
  ctx.fillStyle = badgeGrad;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(255,215,0,0.55)";
  ctx.lineWidth = 1.5;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 21);
  ctx.stroke();
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 19px Sans";
  ctx.textAlign = "center";
  ctx.fillText(`⚔ ROUND ${round}`, W / 2, badgeY + 27);
  // Ornament ticks flanking the badge
  ctx.strokeStyle = "rgba(255,215,0,0.4)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(badgeX - 30, badgeY + badgeH / 2); ctx.lineTo(badgeX - 8, badgeY + badgeH / 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(badgeX + badgeW + 8, badgeY + badgeH / 2); ctx.lineTo(badgeX + badgeW + 30, badgeY + badgeH / 2); ctx.stroke();

  // ── Damage callout ────────────────────────────────────────────────────────
  if (damage != null && hitSide) {
    const cx = hitSide === "enemy"
      ? enemyX + enemySize / 2
      : playerX + playerSize / 2;
    const cy = hitSide === "enemy"
      ? (enemyDrawn?.y ?? enemyY) - 18
      : (playerDrawn?.y ?? playerY) - 14;

    if (crit) {
      // Shockwave rings behind a critical hit
      ctx.save();
      ctx.strokeStyle = "rgba(255,215,0,0.5)";
      ctx.lineWidth = 3;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy, 34 + i * 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fontSize = crit ? 60 : 46;
    ctx.font = `bold ${fontSize}px Sans`;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 5;
    const label = `-${damage}`;
    ctx.strokeText(label, cx, cy);
    ctx.fillStyle = crit ? "#ffd700" : "#ff4444";
    ctx.fillText(label, cx, cy);
    if (crit) {
      ctx.font = "bold 20px Sans";
      ctx.fillStyle = "#ffd700";
      ctx.shadowBlur = 4;
      ctx.fillText("★ CRITICAL! ★", cx, cy - 40);
    }
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  // ── Retro dialogue box ────────────────────────────────────────────────────
  if (statusText) {
    drawRetroMessageBox(ctx, statusText, W);
  }

  return canvas.toBuffer("image/png");
}


/**
 * Draw the pokeball throw animation / catch result.
 * @param {object} opts
 * @param {object} opts.pokemon — { name, imageUrl, level }
 * @param {string} opts.ballType — key from POKEBALL_CATCH_RATES
 * @param {boolean} opts.caught
 * @param {string} [opts.trainerName]
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generateCatchScene({ pokemon, ballType, caught, trainerName = "Trainer" }) {
  const { createCanvas } = await getCanvasModule();
  const W = 960, H = 400;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#1a1a2e");
  bg.addColorStop(1, "#16213e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Stars
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 60; i++) {
    const sx = Math.random() * W;
    const sy = Math.random() * H * 0.6;
    const sr = Math.random() * 1.5 + 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Pokémon sprite (left)
  const pokeImg = await loadImageSafe(pokemon.imageUrl, pokemon.name);
  const pokeSize = 200;
  const pokeX = 80;
  const pokeY = (H - pokeSize) / 2;

  if (caught) {
    // Desaturated / fading into ball
    if (pokeImg) {
      ctx.save();
      try { ctx.filter = "grayscale(0.7) brightness(1.2)"; } catch {}
      ctx.globalAlpha = 0.5;
      ctx.drawImage(pokeImg, pokeX, pokeY, pokeSize, pokeSize);
      ctx.filter = "none";
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  } else {
    if (pokeImg) ctx.drawImage(pokeImg, pokeX, pokeY, pokeSize, pokeSize);
  }

  // Pokemon name + level
  ctx.fillStyle = "#fff";
  ctx.font = "bold 20px Sans";
  ctx.textAlign = "center";
  ctx.fillText(`${pokemon.name} Lv.${pokemon.level}`, pokeX + pokeSize / 2, pokeY + pokeSize + 28);

  // Pokéball (center-right)
  const ballX = W / 2 + 60;
  const ballY = H / 2;
  const ballR = 70;

  // Ball shadow
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(ballX, ballY + ballR + 8, ballR * 0.8, 12, 0, 0, Math.PI * 2);
  ctx.fill();

  // Top half
  const ballColor = getBallColor(ballType);
  ctx.fillStyle = ballColor.top;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballR, Math.PI, 0);
  ctx.fill();

  // Bottom half
  ctx.fillStyle = ballColor.bottom;
  ctx.beginPath();
  ctx.arc(ballX, ballY, ballR, 0, Math.PI);
  ctx.fill();

  // Center band
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(ballX - ballR, ballY);
  ctx.lineTo(ballX + ballR, ballY);
  ctx.stroke();

  // Center button
  ctx.fillStyle = caught ? "#ffe000" : "#fff";
  ctx.beginPath();
  ctx.arc(ballX, ballY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 3;
  ctx.stroke();

  // Shine
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.arc(ballX - 22, ballY - 22, 18, 0, Math.PI * 2);
  ctx.fill();

  // Result text (right side)
  const resultX = W * 0.78;
  const resultY = H / 2;

  if (caught) {
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 38px Sans";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.strokeText("GOTCHA!", resultX, resultY - 20);
    ctx.fillText("GOTCHA!", resultX, resultY - 20);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px Sans";
    ctx.fillText(`${pokemon.name} was caught!`, resultX, resultY + 20);
    ctx.fillStyle = "#aef";
    ctx.font = "18px Sans";
    ctx.fillText(`by ${trainerName}`, resultX, resultY + 50);
  } else {
    ctx.fillStyle = "#ff6b6b";
    ctx.font = "bold 36px Sans";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 4;
    ctx.strokeText("BROKE FREE!", resultX, resultY - 20);
    ctx.fillText("BROKE FREE!", resultX, resultY - 20);
    ctx.fillStyle = "#fff";
    ctx.font = "20px Sans";
    ctx.fillText(`${pokemon.name} escaped!`, resultX, resultY + 20);
    ctx.fillStyle = "#faa";
    ctx.font = "16px Sans";
    ctx.fillText("Try again with a stronger ball.", resultX, resultY + 50);
  }

  return canvas.toBuffer("image/png");
}

function getBallColor(ballType) {
  const colors = {
    pokeball:    { top: "#ff1a1a", bottom: "#fff" },
    greatball:   { top: "#1a6bff", bottom: "#fff" },
    ultraball:   { top: "#f7d02c", bottom: "#1a1a1a" },
    masterball:  { top: "#9c27b0", bottom: "#e91e8c" },
    premierball: { top: "#fff",    bottom: "#fff" },
    healball:    { top: "#ff80ab", bottom: "#fff" },
    duskball:    { top: "#37474f", bottom: "#263238" },
    netball:     { top: "#00695c", bottom: "#fff" },
    luxuryball:  { top: "#1a1a1a", bottom: "#e65100" },
    quickball:   { top: "#1a1aff", bottom: "#f7d02c" },
  };
  return colors[ballType] || colors.pokeball;
}

/**
 * Battle result card after a battle ends.
 */
export async function generateBattleResult({ winner, loser, rewardText = "", outcome = "victory" }) {
  const { createCanvas } = await getCanvasModule();
  const W = 960, H = 480;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  const bg = ctx.createRadialGradient(W / 2, 200, 30, W / 2, 200, 600);
  bg.addColorStop(0, "#2d2000");
  bg.addColorStop(1, "#0a0a0a");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Banner
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 56px Sans";
  ctx.fillText(outcome === "fled" ? "🏃 FLED FROM BATTLE!" : "🏆 VICTORY!", W / 2, 70);

  // Winner image
  const wImg = await loadImageSafe(winner.imageUrl, winner.name);
  const loserImg = await loadImageSafe(loser.imageUrl, loser.name);

  const wSize = 220;
  const wX = (W - wSize) / 2;
  const wY = 100;

  if (wImg) {
    // Draw winner with glow
    ctx.save();
    ctx.shadowColor = "#ffd700";
    ctx.shadowBlur = 30;
    ctx.drawImage(wImg, wX, wY, wSize, wSize);
    ctx.restore();
  }

  ctx.fillStyle = "#fff";
  ctx.font = "bold 28px Sans";
  ctx.textAlign = "center";
  ctx.fillText(winner.name, W / 2, wY + wSize + 36);
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 16px Sans";
  ctx.fillText("WINNER", W / 2, wY + wSize + 60);

  // Loser — small, desaturated
  if (loserImg) {
    const lSize = 110;
    ctx.save();
    try { ctx.filter = "grayscale(1) brightness(0.5)"; } catch {}
    ctx.drawImage(loserImg, W - lSize - 40, H - lSize - 40, lSize, lSize);
    ctx.filter = "none";
    ctx.restore();
  }
  ctx.fillStyle = "#777";
  ctx.font = "14px Sans";
  ctx.textAlign = "right";
  ctx.fillText(loser.name, W - 40, H - 20);

  // Rewards
  if (rewardText) {
    roundRect(ctx, W / 2 - 200, H - 70, 400, 40, 10);
    ctx.fillStyle = "rgba(255,215,0,0.15)";
    ctx.fill();
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 18px Sans";
    ctx.textAlign = "center";
    ctx.fillText(rewardText, W / 2, H - 42);
  }

  return canvas.toBuffer("image/png");
}

/**
 * Starter Pokémon selection canvas.
 * Shows all 7 starters in a 4x2 grid (last row centred) with their names and types.
 * @param {Array} starters — [{ name, displayName, type, emoji, id }]
 */
export async function generateStarterCanvas(starters) {
  const { createCanvas } = await getCanvasModule();
  const COLS = 4;
  const CELL_W = 220;
  const CELL_H = 220;
  const PAD = 20;
  const HEADER_H = 80;

  const rows = Math.ceil(starters.length / COLS);
  const W = COLS * CELL_W + (COLS + 1) * PAD;
  const H = HEADER_H + rows * CELL_H + (rows + 1) * PAD + 20;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0d1b2a");
  bg.addColorStop(1, "#1b2838");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Starfield
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (let i = 0; i < 80; i++) {
    const sx = Math.random() * W;
    const sy = Math.random() * H;
    const sr = Math.random() * 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  // Header
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 34px Sans";
  ctx.fillText("✨ CHOOSE YOUR STARTER POKÉMON! ✨", W / 2, 50);

  // Load all images in parallel
  const images = await Promise.all(
    starters.map((s) =>
      loadImageSafe(
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${s.id}.png`,
        s.name
      )
    )
  );

  for (let i = 0; i < starters.length; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;

    // Centre last row if it's not full
    const rowCount = Math.min(COLS, starters.length - row * COLS);
    const rowStart = (W - (rowCount * CELL_W + (rowCount - 1) * PAD)) / 2;

    const x = rowStart + col * (CELL_W + PAD);
    const y = HEADER_H + PAD + row * (CELL_H + PAD);

    // Card background
    roundRect(ctx, x, y, CELL_W, CELL_H, 14);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,215,0,0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Number badge
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 18px Sans";
    ctx.textAlign = "left";
    ctx.fillText(`#${i + 1}`, x + 10, y + 24);

    // Pokémon image
    const img = images[i];
    const imgSize = 130;
    const imgX = x + (CELL_W - imgSize) / 2;
    const imgY = y + 28;
    if (img) {
      ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(imgX, imgY, imgSize, imgSize);
      ctx.fillStyle = "#888";
      ctx.font = "40px Sans";
      ctx.textAlign = "center";
      ctx.fillText("?", x + CELL_W / 2, imgY + imgSize / 2 + 14);
    }

    // Name
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 17px Sans";
    ctx.textAlign = "center";
    ctx.fillText(starters[i].displayName, x + CELL_W / 2, y + 175);

    // Type
    ctx.fillStyle = "#aad4ff";
    ctx.font = "13px Sans";
    ctx.fillText(`${starters[i].emoji} ${starters[i].type}`, x + CELL_W / 2, y + 196);
  }

  // Footer hint
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "15px Sans";
  ctx.textAlign = "center";
  ctx.fillText("Reply .startjourney <number or name> to choose", W / 2, H - 10);

  return canvas.toBuffer("image/png");
}

/**
 * Party overview canvas.
 * Pikachu-themed battlefield background with all party Pokémon shown as sprites.
 * @param {Array} party  [{ name, displayName, level, hp, maxHp, primaryType, imageUrl, shiny, attack, defense, speed }]
 * @param {string} trainerName
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generatePartyCanvas(party, trainerName = "Trainer") {
  const { createCanvas } = await getCanvasModule();
  const W = 960;
  const H = 540;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // ── Background: Pikachu yellow stadium ──
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  skyGrad.addColorStop(0, "#fff9c4");
  skyGrad.addColorStop(1, "#ffe082");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Ground strip
  const groundGrad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  groundGrad.addColorStop(0, "#8bc34a");
  groundGrad.addColorStop(1, "#558b2f");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, H * 0.55, W, H * 0.45);

  // Stadium ellipse arc
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.55, W * 0.5, 60, 0, Math.PI, 0);
  ctx.stroke();
  ctx.restore();

  // Lightning bolt watermark
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = "#f9a825";
  ctx.beginPath();
  ctx.moveTo(W * 0.44, H * 0.08);
  ctx.lineTo(W * 0.38, H * 0.48);
  ctx.lineTo(W * 0.52, H * 0.38);
  ctx.lineTo(W * 0.46, H * 0.84);
  ctx.lineTo(W * 0.56, H * 0.44);
  ctx.lineTo(W * 0.42, H * 0.52);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // Header bar
  roundRect(ctx, 0, 0, W, 54, 0);
  ctx.fillStyle = "rgba(0,0,0,0.58)";
  ctx.fill();
  ctx.fillStyle = "#ffd700";
  ctx.font = "bold 27px Sans";
  ctx.textAlign = "left";
  ctx.fillText(`${trainerName}'s Party (${party.length}/6)`, 20, 38);

  // Load sprites — try stored URL first, then HD artwork, then regular front sprite
  const imgs = await Promise.all(
    party.map((p) => {
      const id = p.pokedexId;
      return loadImageWithFallbacks([
        p.imageUrl,
        id ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png` : null,
        id ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png` : null,
      ], p.name);
    })
  );

  const typeColors = {
    fire:"#ff6f00",water:"#0277bd",grass:"#388e3c",electric:"#f9a825",
    psychic:"#ad1457",normal:"#546e7a",flying:"#0288d1",bug:"#558b2f",
    poison:"#6a1b9a",rock:"#5d4037",ground:"#ef6c00",ice:"#00838f",
    fighting:"#b71c1c",ghost:"#4a148c",dragon:"#1a237e",dark:"#212121",
    steel:"#455a64",fairy:"#e91e63",
  };
  // Plain-text type labels (no emoji — canvas lacks emoji font on most servers)
  const typeLabels = {
    fire:"Fire",water:"Water",grass:"Grass",electric:"Elec",psychic:"Psych",
    normal:"Nrml",flying:"Fly",bug:"Bug",poison:"Psn",rock:"Rock",
    ground:"Grnd",ice:"Ice",fighting:"Fght",ghost:"Ghost",dragon:"Drgn",
    dark:"Dark",steel:"Steel",fairy:"Fairy",
  };

  const COLS = Math.min(party.length, 3);
  const CARD_W = 280;
  const CARD_H = 200;
  const GAP_X = 20;
  const GAP_Y = 16;

  for (let i = 0; i < party.length; i++) {
    const p = party[i];
    const row = Math.floor(i / COLS);
    const col = i % COLS;

    // Centre the row (handles last row with fewer cards)
    const rowCount = Math.min(COLS, party.length - row * COLS);
    const rowStartX = (W - (rowCount * CARD_W + (rowCount - 1) * GAP_X)) / 2;

    const cx = rowStartX + col * (CARD_W + GAP_X);
    const cy = 64 + row * (CARD_H + GAP_Y);

    const typeColor = typeColors[p.primaryType] || "#546e7a";
    const isFainted = p.hp <= 0;

    // Card background
    roundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
    const cardGrad = ctx.createLinearGradient(cx, cy, cx, cy + CARD_H);
    cardGrad.addColorStop(0, isFainted ? "rgba(30,30,30,0.85)" : "rgba(18,18,36,0.85)");
    cardGrad.addColorStop(1, isFainted ? "rgba(50,50,50,0.85)" : `${typeColor}55`);
    ctx.fillStyle = cardGrad;
    ctx.fill();
    ctx.strokeStyle = isFainted ? "#555" : typeColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Pokémon sprite (right side of card)
    const img = imgs[i];
    const spriteSize = 120;
    const spriteX = cx + CARD_W - spriteSize - 6;
    const spriteY = cy + (CARD_H - spriteSize) / 2;
    if (img) {
      ctx.save();
      if (isFainted) {
        try { ctx.filter = "grayscale(1) brightness(0.35)"; } catch {}
      }
      ctx.drawImage(img, spriteX, spriteY, spriteSize, spriteSize);
      if (isFainted) { try { ctx.filter = "none"; } catch {} }
      ctx.restore();
    }

    // Slot number
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 15px Sans";
    ctx.textAlign = "left";
    ctx.fillText(`#${i + 1}`, cx + 10, cy + 22);

    // Shiny
    if (p.shiny) {
      ctx.fillStyle = "#ffe57f";
      ctx.font = "bold 11px Sans";
      ctx.textAlign = "right";
      ctx.fillText("SHINY", cx + CARD_W - 10, cy + 22);
    }

    // Name
    const nick = p.nickname ? ` "${p.nickname}"` : "";
    ctx.fillStyle = isFainted ? "#888" : "#ffffff";
    ctx.font = "bold 16px Sans";
    ctx.textAlign = "left";
    ctx.fillText(`${p.displayName || p.name}${nick}`, cx + 10, cy + 46);

    // Level + type
    const tLabel = typeLabels[p.primaryType] || p.primaryType;
    ctx.fillStyle = isFainted ? "#666" : "#aad4ff";
    ctx.font = "13px Sans";
    ctx.fillText(`Lv.${p.level}  [${tLabel}]`, cx + 10, cy + 66);

    // HP bar
    const barW = 148;
    const barH = 10;
    const barX = cx + 10;
    const barY = cy + 82;
    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    const barCol = hpPct > 0.5 ? "#4caf50" : hpPct > 0.2 ? "#ff9800" : "#f44336";

    roundRect(ctx, barX, barY, barW, barH, 5);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fill();
    if (hpPct > 0) {
      roundRect(ctx, barX, barY, barW * hpPct, barH, 5);
      ctx.fillStyle = barCol;
      ctx.fill();
    }

    ctx.fillStyle = isFainted ? "#888" : "#ddd";
    ctx.font = "12px Sans";
    ctx.fillText(`HP ${p.hp}/${p.maxHp}${isFainted ? " [KO]" : ""}`, barX, barY + 24);

    // Stats
    ctx.fillStyle = isFainted ? "#555" : "#aaa";
    ctx.font = "12px Sans";
    ctx.fillText(`ATK ${p.attack}  DEF ${p.defense}  SPD ${p.speed || "?"}`, barX, barY + 44);
    const xpNeeded = getPokemonXpNeeded(p.level);
    ctx.fillText(`XP ${p.xp || 0}/${xpNeeded || "MAX"}`, barX, barY + 60);

    ctx.fillStyle = isFainted ? "#ff8a80" : "#8cff98";
    ctx.font = "bold 12px Sans";
    ctx.fillText(`STATUS: ${isFainted ? "FAINTED" : "ALIVE"}`, barX, barY + 78);
  }

  // Footer
  ctx.fillStyle = "rgba(0,0,0,0.52)";
  ctx.fillRect(0, H - 34, W, 34);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "14px Sans";
  ctx.textAlign = "center";
  ctx.fillText("** Pikachu says: Ready to battle! **", W / 2, H - 10);

  return canvas.toBuffer("image/png");
}
