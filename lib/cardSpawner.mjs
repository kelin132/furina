/**
 * KELIN MD — Card Auto-Spawner
 * Every 12–15 minutes, drops a random card in every group that has spawning enabled.
 * Cards are fetched from the external Card API via lib/cardApi.mjs.
 * The global.activeSpawns object is shared with plugins/cards/claim.js.
 */

import { pickRandomCard, createSpawnId, buildCardSpawnCaption, sendCardMedia } from "./cardApi.mjs";
import { getSeries } from "./seriesEnrich.mjs";
import { getSocket }             from "./bot.mjs";
import { getEnabledSpawnChats }  from "../plugins/cards/db.js";
import { log }                   from "./logger.mjs";
import { reserveCardSpawn, releaseCardSpawn } from "./cardSpawnState.mjs";
import { isCardSpawnClaimReserved } from "./cardSpawnClaim.mjs";

const SPAWN_MIN_MS = 12 * 60 * 1000; // 12 minutes
const SPAWN_MAX_MS = 15 * 60 * 1000; // 15 minutes
const randSpawnMs  = () => SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS);

async function spawnCardInChat(sock, chatId) {
  const activeSpawns = global.activeSpawns || (global.activeSpawns = {});
  if (!reserveCardSpawn(chatId)) return false;
  let spawnId;
  try {
    const card = await pickRandomCard();
    if (!card) return false;
    if (!card.series || card.series === "Unknown") {
      card.series = await getSeries(card.name, { timeout: 4000 });
    }
    if (activeSpawns[chatId]) return false;

    // Store the full card object so claim.js doesn't need a DB lookup
    spawnId = createSpawnId();
    activeSpawns[chatId] = { cardId: card.cardId, spawnId, card };
    const caption = buildCardSpawnCaption(card, spawnId);
    await sendCardMedia(sock, chatId, card, caption);
    if (activeSpawns[chatId]?.spawnId !== spawnId) return false;

    // Auto-expire after 10 minutes if unclaimed
    const expireSpawn = () => {
      const active = activeSpawns[chatId];
      if (active?.spawnId !== spawnId) return;
      if (isCardSpawnClaimReserved(active)) {
        setTimeout(expireSpawn, 1000);
        return;
      }
      delete activeSpawns[chatId];
      sock.sendMessage(chatId, {
        text: `⏰ *${card.name}* was not claimed in time and vanished into the void...`,
      }).catch(() => {});
    };
    setTimeout(expireSpawn, 10 * 60 * 1000);
    return true;

  } catch (err) {
    if (activeSpawns[chatId]?.spawnId === spawnId) delete activeSpawns[chatId];
    log("warn", `[cardSpawner] Failed to spawn in ${chatId}: ${err.message}`);
    return false;
  } finally {
    releaseCardSpawn(chatId);
  }
}

async function runSpawnCycle() {
  try {
    const sock = getSocket();
    if (!sock) return;

    const chats = await getEnabledSpawnChats();
    if (!chats.length) return;

    let spawned = 0;
    for (const chatId of chats) {
      if (await spawnCardInChat(sock, chatId)) spawned += 1;
    }

    log("info", `[cardSpawner] Spawned cards in ${spawned}/${chats.length} enabled chat(s)`);
  } catch (err) {
    log("warn", `[cardSpawner] Cycle error: ${err.message}`);
  }
}

export function startCardSpawner() {
  if (!global.activeSpawns) global.activeSpawns = {};
  // autoSpawn.js is the canonical loop; this remains as a safe fallback for
  // deployments which still start the legacy module directly.
  if (global.__cardApiSpawnerRunning) {
    log("info", "[cardSpawner] Another card auto-spawner is already active");
    return;
  }
  global.__cardApiSpawnerRunning = true;

  log("info", "[cardSpawner] Started — spawning every 12–15 minutes (randomised)");
  function scheduleNext() {
    setTimeout(async () => { await runSpawnCycle(); scheduleNext(); }, randSpawnMs());
  }
  scheduleNext();
}
