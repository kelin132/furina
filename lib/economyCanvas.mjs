/**
 * KELIN MD — Economy Canvas Image Generator  (v3 — text-box aesthetic)
 *
 * Renders the exact  ╭─❀「 TITLE 」❀─╮  /  │  /  ╰───────────────❀
 * chat-box format as a styled canvas image (dark BG, gold borders,
 * coloured values) then returns a PNG Buffer for WhatsApp.
 *
 * Public API:
 *   generateShopPurchaseImage({ itemName, itemDesc, pricePaid, remainingRyo })
 *   generateBalanceImage({ tag, cash, bank, genesisCrystals, level, xp, role })
 *   generateWorkImage({ fired, jobKey, jobEmoji, earned, bonus, xpGained, balance, leveled, level })
 *   generateSlotsImage({ reels, resultMsg, bet, winnings, balance, diamondReward, leveled, level })
 *   generateDailyImage({ reward, xpBonus, balance, level, leveled })
 */

let canvasModulePromise;

async function getCanvas() {
  canvasModulePromise ??= import("canvas");
  return canvasModulePromise;
}

// ─── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:     "#0a0a0f",
  panel:  "#0f0f18",
  gold:   "#f5c842",
  green:  "#22c55e",
  red:    "#ef4444",
  blue:   "#60a5fa",
  white:  "#ffffff",
  muted:  "#9ca3af",
  purple: "#a78bfa",
};

// ─── Core renderer ────────────────────────────────────────────────────────────

const FONT      = "Arial";
const FONT_SIZE = 17;          // px
const LINE_H    = 30;          // px between baselines
const PAD_X     = 28;          // left margin
const PAD_Y     = 22;          // top / bottom margin

/**
 * Line descriptor variants:
 *   "header"    → ╭─❀「 title 」❀─╮
 *   "footer"    → ╰───────────────❀
 *   "empty"     → │
 *   "row"       → │ [label] :: [value]
 *   "plain"     → │ [text]
 *   "reels"     → │   ╔══A══B══C══╗  /  │   ╚═══════════╝
 *   "levelup"   → special banner
 */

/**
 * Measure the widest non-header/footer line to auto-size the canvas.
 * We always use a fixed 520 px width — comfortable for all cases.
 */
const CANVAS_W = 520;

/**
 * Split a string on `::` and return [labelPart, valuePart] or [fullText].
 */
function splitRow(text) {
  const idx = text.indexOf("::");
  if (idx === -1) return [null, text];
  return [text.slice(0, idx + 2), text.slice(idx + 2)];
}

/** Strip WhatsApp * and _ markers for canvas rendering */
function strip(s) { return s.replace(/[*_]/g, ""); }

/**
 * Determine value colour from the value string content.
 * Callers may pass an explicit override via `valueColor`.
 */
function autoValueColor(val, override) {
  if (override) return override;
  const u = val.toUpperCase();
  if (/WIN|WON|JACKPOT|PAYDAY|COMPLETE|HIRED|\+\$/.test(u)) return C.green;
  if (/LOSE|LOST|FIRED|NO MATCH|-\$/.test(u))                return C.red;
  if (/\d+\s*(GEM|DIAMOND)/i.test(u))                        return C.purple;
  if (/XP|LEVEL/i.test(u))                                   return C.blue;
  return C.white;
}

/**
 * Draw multi-part styled text left-to-right and return the final x.
 * Each part: { text, color, bold?, italic? }
 */
function drawParts(ctx, parts, x, y) {
  let cx = x;
  for (const p of parts) {
    const style = p.bold ? "bold " : p.italic ? "italic " : "";
    ctx.font      = `${style}${FONT_SIZE}px ${FONT}`;
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, cx, y);
    cx += ctx.measureText(p.text).width;
  }
  return cx;
}

/**
 * Core: render an array of line descriptors into a canvas and return PNG buffer.
 *
 * @param {Array}  lines   — see typedef in each generator below
 * @param {string} titleText — used only to measure for header line length
 */
async function buildCanvas(lines) {
  const { createCanvas } = await getCanvas();
  const H = PAD_Y + LINE_H * lines.length + PAD_Y;
  const canvas = createCanvas(CANVAS_W, H);
  const ctx    = canvas.getContext("2d");

  // ── Background ────────────────────────────────────────────────────────────
  const bgGrad = ctx.createLinearGradient(0, 0, CANVAS_W, H);
  bgGrad.addColorStop(0,   "#0a0a0f");
  bgGrad.addColorStop(0.5, "#0d0d16");
  bgGrad.addColorStop(1,   "#0a0a0f");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, CANVAS_W, H);

  // Subtle scanline texture
  ctx.fillStyle = "rgba(255,255,255,0.012)";
  for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, CANVAS_W, 1);

  // ── Render lines ──────────────────────────────────────────────────────────
  let baseY = PAD_Y + FONT_SIZE; // first baseline

  for (const line of lines) {
    const y = baseY;

    switch (line.type) {

      // ╭─❀「 TITLE 」❀─╮
      case "header": {
        const text = `╭─❀「 ${line.title} 」❀─╮`;
        ctx.font      = `bold ${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.shadowColor = C.gold;
        ctx.shadowBlur  = 8;
        ctx.textAlign = "left";
        ctx.fillText(text, PAD_X, y);
        ctx.shadowBlur = 0;
        break;
      }

      // ╰───────────────❀
      case "footer": {
        ctx.font      = `bold ${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.shadowColor = C.gold;
        ctx.shadowBlur  = 8;
        ctx.fillText("╰───────────────❀", PAD_X, y);
        ctx.shadowBlur = 0;
        break;
      }

      // │
      case "empty": {
        ctx.font      = `${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.fillText("│", PAD_X, y);
        break;
      }

      // │ label :: value  OR  │ plain text
      case "row": {
        const pipeW = (() => {
          ctx.font = `${FONT_SIZE}px ${FONT}`;
          return ctx.measureText("│ ").width;
        })();

        // Draw pipe
        ctx.font      = `${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.fillText("│ ", PAD_X, y);

        const content = line.text || "";
        if (content.includes("::")) {
          const [rawLabel, rawValue] = splitRow(content);
          const label = strip(rawLabel);
          const value = strip(rawValue).trimStart();
          const vCol  = autoValueColor(value, line.valueColor);

          drawParts(ctx, [
            { text: label, color: C.muted, bold: false },
            { text: " " + value, color: vCol, bold: true },
          ], PAD_X + pipeW, y);
        } else {
          // plain content
          const plain = strip(content);
          ctx.font      = `${FONT_SIZE}px ${FONT}`;
          ctx.fillStyle = line.color || C.white;
          ctx.fillText(plain, PAD_X + pipeW, y);
        }
        break;
      }

      // italic flavour line:  │ 🍃 Flavour :: _japanese_
      case "flavour": {
        const pipeW = (() => {
          ctx.font = `${FONT_SIZE}px ${FONT}`;
          return ctx.measureText("│ ").width;
        })();
        ctx.font      = `${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.fillText("│ ", PAD_X, y);

        const [rawLabel, rawItalic] = splitRow(line.text || "");
        const label  = strip(rawLabel || "");
        const italic = strip(rawItalic || "").trimStart();

        drawParts(ctx, [
          { text: label,  color: C.muted,  bold: false },
          { text: " " + italic, color: C.muted, italic: true },
        ], PAD_X + pipeW, y);
        break;
      }

      // Reel display line (pre-formatted, centred)
      case "reels": {
        ctx.font      = `${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle = C.gold;
        ctx.fillText("│ ", PAD_X, y);

        const reelStr = line.text;
        ctx.font      = "20px Arial"; // bigger for emoji reels
        ctx.fillStyle = C.white;
        ctx.textAlign = "center";
        ctx.fillText(reelStr, CANVAS_W / 2, y);
        ctx.textAlign = "left";
        break;
      }

      // Level-up celebration banner
      case "levelup": {
        // golden highlight bar
        ctx.fillStyle = "rgba(245,200,66,0.10)";
        ctx.fillRect(PAD_X - 4, y - FONT_SIZE + 4, CANVAS_W - PAD_X * 2 + 8, LINE_H - 2);

        ctx.font        = `bold ${FONT_SIZE}px ${FONT}`;
        ctx.fillStyle   = C.gold;
        ctx.shadowColor = C.gold;
        ctx.shadowBlur  = 10;
        ctx.textAlign   = "center";
        ctx.fillText(`🎉 LEVEL UP! — Now Level ${line.level}`, CANVAS_W / 2, y);
        ctx.shadowBlur  = 0;
        ctx.textAlign   = "left";
        break;
      }

      default: break;
    }

    baseY += LINE_H;
  }

  return canvas.toBuffer("image/png");
}

// ─── Money formatter (shared) ─────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toLocaleString()}`;
}

// ─── 1. SHOP PURCHASE ─────────────────────────────────────────────────────────
export async function generateShopPurchaseImage({ itemName, itemDesc, pricePaid, remainingRyo }) {
  const name = itemName.length > 30 ? itemName.slice(0, 28) + "…" : itemName;
  const desc = (itemDesc || "").length > 42 ? itemDesc.slice(0, 40) + "…" : (itemDesc || "");

  const lines = [
    { type: "header", title: "🛍️ 𝐒𝐇𝐎𝐏" },
    { type: "row",    text: `✅ *Result*  :: *PURCHASE COMPLETE* 🟢`, valueColor: C.green },
    { type: "row",    text: `🛒 *Item*    :: *${name}*` },
    { type: "flavour",text: `📝 *Desc*    :: _${desc}_` },
    { type: "empty" },
    { type: "row",    text: `💸 *Paid*    :: *${fmt(pricePaid)}*`, valueColor: C.red },
    { type: "row",    text: `💰 *Balance* :: *${fmt(remainingRyo)}*`, valueColor: C.green },
    { type: "empty" },
    { type: "row",    text: `🎒 Use *.ninventory* to view your items`, color: C.muted },
    { type: "footer" },
  ];

  return buildCanvas(lines);
}

// ─── 2. BALANCE ───────────────────────────────────────────────────────────────
export async function generateBalanceImage({ tag, cash, bank, genesisCrystals, diamonds = 0, level, xp, role }) {
  const crystals = genesisCrystals ?? diamonds;
  const net     = cash + bank;
  const xpInLv  = xp % 1000;

  const lines = [
    { type: "header", title: "💰 𝐖𝐀𝐋𝐋𝐄𝐓" },
    { type: "row",    text: `👤 *User*    :: *@${tag}*` },
    { type: "row",    text: `💎 *Net Worth*:: *${fmt(net)}*`, valueColor: C.gold },
    { type: "empty" },
    { type: "row",    text: `💰 *Cash*    :: *${fmt(cash)}*`,        valueColor: C.green },
    { type: "row",    text: `🏦 *Bank*    :: *${fmt(bank)}*`,        valueColor: C.blue },
    { type: "row",    text: `💎 *Genesis Crystals* :: *${crystals}*`, valueColor: C.purple },
    { type: "empty" },
    { type: "row",    text: `⭐ *Level*   :: *${level}*`,            valueColor: C.gold },
    { type: "row",    text: `🔮 *XP*      :: *${xpInLv} / 1000*`,   valueColor: C.blue },
    { type: "row",    text: `🎭 *Role*    :: *${role}*`,             valueColor: C.muted },
    { type: "empty" },
    { type: "row",    text: `🏦 Buy higher bank limits in *.shop banking*`, color: C.muted },
    { type: "footer" },
  ];

  return buildCanvas(lines);
}

// ─── 3. WORK ──────────────────────────────────────────────────────────────────
const WORK_WIN_LINES  = ["お疲れ様！よくやった！", "給料日だ！💰", "また一日生き延びた！", "頑張ったね！"];
const WORK_LOSE_LINES = ["クビになった…残念！", "また頑張ろう！", "新しい仕事を探せ！", "運が悪かった…"];

function rndFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

export async function generateWorkImage({ fired, jobKey, jobEmoji, earned, bonus, xpGained, balance, leveled, level }) {
  const flavour = rndFrom(fired ? WORK_LOSE_LINES : WORK_WIN_LINES);
  const basePay = earned - (bonus || 0);

  const lines = [
    { type: "header", title: `💼 𝐖𝐎𝐑𝐊` },
    { type: "row",    text: `🌙 *Result*  :: *${fired ? "FIRED 🔴" : "PAYDAY 🟢"}*`, valueColor: fired ? C.red : C.green },
    { type: "flavour",text: `🍃 *Flavour* :: _${flavour}_` },
    { type: "empty" },
    { type: "row",    text: `${jobEmoji} *Job*     :: *${jobKey}*` },
    { type: "row",    text: `💰 *${fired ? "Severance" : "Base Pay"}* :: *${fired ? "" : "+"}${fmt(basePay)}*`, valueColor: fired ? C.red : C.green },
    ...((!fired && bonus > 0) ? [
      { type: "row",  text: `🎁 *Bonus*   :: *+${fmt(bonus)}*`, valueColor: C.gold },
    ] : []),
    { type: "row",    text: `🔮 *XP*      :: *+${xpGained} xp*`,   valueColor: C.blue },
    { type: "row",    text: `💰 *Wallet*  :: *${fmt(balance)}*`,    valueColor: C.white },
    { type: "empty" },
    { type: "row",    text: fired
        ? `📋 Use *.work jobs* to find a new position!`
        : `⚠️ *30% fire risk* each shift — stay sharp!`,
      color: C.muted },
    ...(leveled ? [
      { type: "empty" },
      { type: "levelup", level },
    ] : []),
    { type: "footer" },
  ];

  return buildCanvas(lines);
}

// ─── 4. SLOTS ─────────────────────────────────────────────────────────────────
export async function generateSlotsImage({ reels, resultMsg, bet, winnings, balance, diamondReward, leveled, level }) {
  const won     = winnings > 0;
  const jackpot = resultMsg.toLowerCase().startsWith("jackpot");
  const net     = winnings - bet;

  const [a, b, c] = reels;

  const lines = [
    { type: "header", title: "🎰 𝐒𝐋𝐎𝐓𝐒" },
    { type: "row",    text: `🌙 *Result*  :: *${resultMsg} ${jackpot ? "🟡" : won ? "🟢" : "🔴"}*`,
                      valueColor: jackpot ? C.gold : won ? C.green : C.red },
    { type: "empty" },
    { type: "reels",  text: `╔══${a}══${b}══${c}══╗` },
    { type: "reels",  text: `╚══════════════╝` },
    { type: "empty" },
    { type: "row",    text: `💰 *Wagered* :: *${fmt(bet)}*` },
    { type: "row",
      text: won
        ? `💰 *Won*     :: *+${fmt(winnings)}*`
        : `📉 *Lost*    :: *-${fmt(bet)}*`,
      valueColor: won ? C.green : C.red },
    { type: "row",    text: `💰 *Wallet*  :: *${fmt(balance)}*` },
    ...(diamondReward ? [
      { type: "row",  text: `💎 *Bonus*   :: *+${diamondReward} Genesis Crystal${diamondReward === 1 ? "" : "s"}*`, valueColor: C.purple },
    ] : []),
    { type: "empty" },
    { type: "row",
      text: jackpot
        ? `✨ *JACKPOT!* おめでとう！🎉`
        : won
          ? `🌸 *Partial win!* Two matching 🎊`
          : `💀 *Better luck next time!* 頑張れ！`,
      color: jackpot ? C.gold : won ? C.green : C.red },
    ...(leveled ? [
      { type: "empty" },
      { type: "levelup", level },
    ] : []),
    { type: "footer" },
  ];

  return buildCanvas(lines);
}

// ─── 5. DAILY ─────────────────────────────────────────────────────────────────
const DAILY_LINES = [
  "今日も頑張ろう！", "毎日コツコツ積み上げよう！", "継続は力なり！", "お金持ちへの道！",
];

export async function generateDailyImage({ reward, xpBonus, balance, level, leveled }) {
  const flavour = rndFrom(DAILY_LINES);

  const lines = [
    { type: "header", title: "🌟 𝐃𝐀𝐈𝐋𝐘" },
    { type: "row",    text: `🌙 *Result*  :: *CLAIMED 🟢*`, valueColor: C.green },
    { type: "flavour",text: `🍃 *Flavour* :: _${flavour}_` },
    { type: "empty" },
    { type: "row",    text: `💰 *Reward*  :: *+${fmt(reward)}*`,    valueColor: C.gold },
    { type: "row",    text: `🔮 *XP*      :: *+${xpBonus} xp*`,    valueColor: C.blue },
    { type: "row",    text: `💰 *Wallet*  :: *${fmt(balance)}*` },
    { type: "empty" },
    { type: "row",    text: `⭐ *Level ${level}*  🔥 *Streak active!*`, color: C.gold },
    ...(leveled ? [
      { type: "empty" },
      { type: "levelup", level },
    ] : []),
    { type: "footer" },
  ];

  return buildCanvas(lines);
}

export default {
  generateShopPurchaseImage,
  generateBalanceImage,
  generateWorkImage,
  generateSlotsImage,
  generateDailyImage,
};
