/**
 * KELIN MD — PC Storage canvas renderer
 * Draws a visual grid card of the trainer's boxed Pokémon:
 * sprite, name, level, type badge, HP bar, and XP bar per slot.
 *
 * Uses the `canvas` package — same conventions as lib/battleCanvas.mjs.
 */

let canvasModulePromise;
async function getCanvasModule() {
  canvasModulePromise ??= import("canvas");
  return canvasModulePromise;
}

async function loadImageSafe(url, label = "sprite") {
  if (!url) return null;
  try {
    const { loadImage } = await getCanvasModule();
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (KelinMD-Bot)" },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return await loadImage(buf);
  } catch {
    return null;
  }
}

/** Try multiple URLs in order, return first that loads successfully */
async function loadImageWithFallbacks(urls, label = "sprite") {
  for (const url of urls) {
    if (!url) continue;
    const img = await loadImageSafe(url, label);
    if (img) return img;
  }
  return null;
}

function roundRect(ctx, x, y, w, h, r) {
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

function hpColor(hp, maxHp) {
  const pct = maxHp > 0 ? hp / maxHp : 0;
  if (pct > 0.5) return "#3ddc61";
  if (pct > 0.25) return "#f2c94c";
  return "#eb4d4d";
}

function drawBar(ctx, x, y, w, h, current, max, fillColor) {
  const pct = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  // Background
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  ctx.fill();
  // Fill
  if (pct > 0) {
    roundRect(ctx, x, y, Math.max(h, w * pct), h, h / 2);
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
}

const TYPE_COLORS = {
  fire:     "#f97316", water:    "#3b82f6", grass:    "#22c55e",
  electric: "#eab308", psychic:  "#ec4899", normal:   "#94a3b8",
  flying:   "#38bdf8", bug:      "#84cc16", poison:   "#a855f7",
  rock:     "#78716c", ground:   "#d97706", ice:      "#22d3ee",
  fighting: "#ef4444", ghost:    "#8b5cf6", dragon:   "#6366f1",
  dark:     "#64748b", steel:    "#9ca3af", fairy:    "#f472b6",
};

const TYPE_LABEL = {
  fire:"FIRE",water:"WATER",grass:"GRASS",electric:"ELECTRIC",psychic:"PSYCHIC",
  normal:"NORMAL",flying:"FLYING",bug:"BUG",poison:"POISON",rock:"ROCK",
  ground:"GROUND",ice:"ICE",fighting:"FIGHT",ghost:"GHOST",dragon:"DRAGON",
  dark:"DARK",steel:"STEEL",fairy:"FAIRY",
};

/**
 * Draw a single Pokémon card at position (cx, cy).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} pokemon  — full db document
 * @param {Image|null} sprite
 * @param {number} cx  card top-left x
 * @param {number} cy  card top-left y
 * @param {number} cw  card width
 * @param {number} ch  card height
 * @param {number} idx  1-based slot number
 */
function drawCard(ctx, pokemon, sprite, cx, cy, cw, ch, idx) {
  const type   = (pokemon.primaryType || "normal").toLowerCase();
  const accent = TYPE_COLORS[type] || "#94a3b8";
  const fainted = pokemon.hp === 0;

  // Card background
  ctx.save();
  roundRect(ctx, cx, cy, cw, ch, 12);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fill();
  ctx.strokeStyle = fainted ? "rgba(255,255,255,0.08)" : `${accent}55`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Shiny sparkle background tint
  if (pokemon.shiny) {
    ctx.save();
    roundRect(ctx, cx, cy, cw, ch, 12);
    ctx.fillStyle = "rgba(250,204,21,0.05)";
    ctx.fill();
    ctx.restore();
  }

  const PAD  = 10;
  const sprW = 64;
  const sprX = cx + PAD;
  const sprY = cy + (ch - sprW) / 2;

  // Sprite background circle
  ctx.save();
  ctx.beginPath();
  ctx.arc(sprX + sprW / 2, sprY + sprW / 2, sprW / 2 + 2, 0, Math.PI * 2);
  ctx.fillStyle = `${accent}18`;
  ctx.fill();
  ctx.restore();

  // Sprite image (or placeholder)
  ctx.save();
  if (fainted) {
    try { ctx.filter = "grayscale(1) brightness(0.5)"; } catch {}
  }
  if (sprite) {
    ctx.drawImage(sprite, sprX, sprY, sprW, sprW);
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "bold 28px Sans";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", sprX + sprW / 2, sprY + sprW / 2);
    ctx.textBaseline = "alphabetic";
  }
  ctx.filter = "none";
  ctx.restore();

  // Shiny badge
  if (pokemon.shiny) {
    ctx.font = "bold 9px Sans";
    ctx.textAlign = "center";
    ctx.fillStyle = "#fbbf24";
    ctx.fillText("SHINY", sprX + sprW / 2, sprY - 2);
  }

  // Name label under sprite
  const underName = (pokemon.nickname || pokemon.displayName || pokemon.name || "???");
  const shortName = underName.length > 11 ? underName.slice(0, 10) + "…" : underName;
  ctx.font = "bold 13px Sans";
  ctx.textAlign = "center";
  ctx.fillStyle = fainted ? "rgba(255,255,255,0.30)" : "#ffffff";
  ctx.fillText(shortName, sprX + sprW / 2, sprY + sprW + 16);
  ctx.textAlign = "left";

  // Slot index (top-left corner of card)
  ctx.font = "bold 11px Sans";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText(`#${idx}`, cx + PAD, cy + 14);

  // Right side layout
  const rx    = cx + PAD + sprW + 10;
  const rw    = cw - PAD - sprW - 10 - PAD;
  let   ry    = cy + 14;

  // Name
  const displayName = pokemon.nickname
    ? `${pokemon.nickname}`
    : (pokemon.displayName || pokemon.name || "???");
  const name = displayName.length > 13 ? displayName.slice(0, 12) + "…" : displayName;

  ctx.font = "bold 14px Sans";
  ctx.textAlign = "left";
  ctx.fillStyle = fainted ? "rgba(255,255,255,0.35)" : "#ffffff";
  ctx.fillText(name, rx, ry);

  // Fainted tag
  if (fainted) {
    const fw = 48, fh = 14;
    const fx = cx + cw - PAD - fw;
    const fy = cy + PAD - 1;
    roundRect(ctx, fx, fy, fw, fh, 4);
    ctx.fillStyle = "rgba(235,77,77,0.25)";
    ctx.fill();
    ctx.fillStyle = "#eb4d4d";
    ctx.font = "bold 9px Sans";
    ctx.textAlign = "center";
    ctx.fillText("FAINTED", fx + fw / 2, fy + 10);
    ctx.textAlign = "left";
  }

  ry += 16;

  // Level + type pill on same row
  ctx.font = "bold 11px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.50)";
  ctx.textAlign = "left";
  ctx.fillText(`Lv.${pokemon.level}`, rx, ry);

  // Type pill
  const tLabel = TYPE_LABEL[type] || type.toUpperCase();
  const pillW  = Math.max(38, ctx.measureText(tLabel).width + 10);
  const pillH  = 13;
  const pillX  = rx + 34;
  const pillY  = ry - pillH + 2;
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fillStyle = `${accent}33`;
  ctx.fill();
  ctx.strokeStyle = `${accent}77`;
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.font = "bold 8px Sans";
  ctx.fillStyle = accent;
  ctx.textAlign = "center";
  ctx.fillText(tLabel, pillX + pillW / 2, pillY + 9);
  ctx.textAlign = "left";

  ry += 10;

  // HP bar
  const barW = rw;
  const barH = 6;

  ctx.font = "bold 9px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText("HP", rx, ry + barH);
  drawBar(ctx, rx + 18, ry, barW - 18, barH, pokemon.hp, pokemon.maxHp, hpColor(pokemon.hp, pokemon.maxHp));
  ctx.font = "9px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "right";
  ctx.fillText(`${pokemon.hp}/${pokemon.maxHp}`, rx + barW, ry + barH);
  ctx.textAlign = "left";

  ry += barH + 7;

  // XP bar
  const xpNeeded = pokemon.xpNeeded || 1;
  ctx.font = "bold 9px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText("XP", rx, ry + barH);
  drawBar(ctx, rx + 18, ry, barW - 18, barH, pokemon.xp || 0, xpNeeded, "#3b82f6");
  ctx.font = "9px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.textAlign = "right";
  ctx.fillText(`${pokemon.xp || 0}/${xpNeeded}`, rx + barW, ry + barH);
  ctx.textAlign = "left";
}

/**
 * Render the PC Storage page as a PNG image.
 *
 * @param {object[]} slice        — Pokémon on this page (already sliced)
 * @param {number}   currentPage
 * @param {number}   totalPages
 * @param {number}   totalPokemon
 * @returns {Promise<Buffer>} PNG buffer
 */
export async function generatePcStorage(slice, currentPage, totalPages, totalPokemon) {
  const { createCanvas } = await getCanvasModule();

  // Dimensions
  const COLS   = 2;
  const ROWS   = Math.ceil(slice.length / COLS);
  const CARD_W = 420;
  const CARD_H = 118;
  const GAP    = 10;
  const PAD_X  = 30;
  const PAD_Y  = 30;
  const HEADER = 70;
  const FOOTER = 44;

  const W = PAD_X * 2 + COLS * CARD_W + (COLS - 1) * GAP;
  const H = PAD_Y + HEADER + ROWS * CARD_H + (ROWS - 1) * GAP + FOOTER + PAD_Y;

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext("2d");

  /* ── BACKGROUND ── */
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0,   "#0f1117");
  bg.addColorStop(0.5, "#141820");
  bg.addColorStop(1,   "#0c1016");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle radial glow top-left
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 500);
  glow.addColorStop(0,   "rgba(99,102,241,0.12)");
  glow.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  /* ── OUTER BORDER ── */
  ctx.save();
  ctx.shadowColor = "rgba(99,102,241,0.35)";
  ctx.shadowBlur  = 18;
  ctx.strokeStyle = "rgba(99,102,241,0.40)";
  ctx.lineWidth   = 1.5;
  roundRect(ctx, 12, 12, W - 24, H - 24, 18);
  ctx.stroke();
  ctx.restore();

  /* ── HEADER ── */
  const hx = PAD_X;
  const hy = PAD_Y;

  // Box icon background
  roundRect(ctx, hx, hy, 44, 44, 10);
  ctx.fillStyle = "rgba(99,102,241,0.18)";
  ctx.fill();
  ctx.strokeStyle = "rgba(99,102,241,0.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Draw a simple box icon (no emoji — canvas lacks emoji font on most servers)
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.strokeRect(hx + 10, hy + 10, 24, 24);
  ctx.strokeRect(hx + 10, hy + 10, 24, 10);
  ctx.textBaseline = "alphabetic";

  // Title
  ctx.font = "bold 24px Sans";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText("PC STORAGE", hx + 54, hy + 24);

  // Subtitle
  ctx.font = "13px Sans";
  ctx.fillStyle = "rgba(255,255,255,0.40)";
  ctx.fillText(`Page ${currentPage}/${totalPages}  •  ${totalPokemon} Pokémon`, hx + 54, hy + 41);

  // Divider line
  const divY = hy + HEADER - 10;
  const divGrad = ctx.createLinearGradient(PAD_X, divY, W - PAD_X, divY);
  divGrad.addColorStop(0,   "rgba(99,102,241,0.55)");
  divGrad.addColorStop(0.6, "rgba(99,102,241,0.20)");
  divGrad.addColorStop(1,   "rgba(0,0,0,0)");
  ctx.strokeStyle = divGrad;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, divY);
  ctx.lineTo(W - PAD_X, divY);
  ctx.stroke();

  /* ── POKÉMON CARDS ── */
  // Load all sprites in parallel — try stored URL, then HD artwork, then regular front sprite
  const sprites = await Promise.all(slice.map(p => {
    const id = p.pokedexId;
    return loadImageWithFallbacks([
      p.imageUrl,
      id ? `https://pokeapi.eulaorg.app/api/sprites/${id}?variant=front` : null,
      id ? `https://pokeapi.eulaorg.app/api/sprites/${id}?variant=front` : null,
    ], p.displayName || p.name);
  }));

  const gridTop = PAD_Y + HEADER;
  for (let i = 0; i < slice.length; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const cx  = PAD_X + col * (CARD_W + GAP);
    const cy  = gridTop + row * (CARD_H + GAP);
    drawCard(ctx, slice[i], sprites[i], cx, cy, CARD_W, CARD_H, i + 1);
  }

  /* ── FOOTER ── */
  const footY = H - PAD_Y - FOOTER + 14;

  // Separator
  const sepGrad = ctx.createLinearGradient(PAD_X, footY - 8, W - PAD_X, footY - 8);
  sepGrad.addColorStop(0,   "rgba(255,255,255,0)");
  sepGrad.addColorStop(0.2, "rgba(255,255,255,0.10)");
  sepGrad.addColorStop(0.8, "rgba(255,255,255,0.10)");
  sepGrad.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.strokeStyle = sepGrad;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PAD_X, footY - 8);
  ctx.lineTo(W - PAD_X, footY - 8);
  ctx.stroke();

  ctx.font      = "12px Sans";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillText("*.t2party <name or #>* to withdraw  •  *.pc <page>* to flip pages", PAD_X, footY + 12);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillText("KELIN MD  •  PC STORAGE", W - PAD_X, footY + 12);

  return canvas.toBuffer("image/png");
}
