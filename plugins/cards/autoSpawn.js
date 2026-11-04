/**
 * KELIN MD — autoSpawn.js
 * Self-starting card spawner loaded as a plugin.
 * Replaces the need for cardSpawner.mjs to be updated on the panel —
 * since this is a NEW file, the panel picks it up automatically.
 *
 * Cards are fetched from the external Card API via lib/cardApi.mjs.
 * The shared singleton guard also prevents the legacy cardSpawner.mjs loop
 * from starting a second scheduler in standalone mode.
 */
import { pickRandomCard, createSpawnId, buildCardSpawnCaption, sendCardMedia } from "../../lib/cardApi.mjs";
import { getSeries } from "../../lib/seriesEnrich.mjs";
import { getEnabledSpawnChats }            from "./db.js";
import { log }                             from "../../lib/logger.mjs";
import { reserveCardSpawn, releaseCardSpawn } from "../../lib/cardSpawnState.mjs";
import { isCardSpawnClaimReserved } from "../../lib/cardSpawnClaim.mjs";

const SPAWN_MIN_MS       = 12 * 60 * 1000; // 12 minutes
const SPAWN_MAX_MS       = 15 * 60 * 1000; // 15 minutes
const randSpawnMs        = () => SPAWN_MIN_MS + Math.random() * (SPAWN_MAX_MS - SPAWN_MIN_MS);
const EXPIRE_MS          = 10 * 60 * 1000; // 10 minutes claim window

// Prevent double-starting if both this and the old cardSpawner are loaded
if (!global.__cardApiSpawnerRunning) {
  global.__cardApiSpawnerRunning = true;

  async function spawnCardInChat(sock, chatId) {
    const spawns = global.activeSpawns || (global.activeSpawns = {});
    if (!reserveCardSpawn(chatId)) return false;
    let spawnId;
    try {
      const card = await pickRandomCard();
      if (!card) return false;
      if (!card.series || card.series === "Unknown") {
        card.series = await getSeries(card.name, { timeout: 4000 });
      }
      if (spawns[chatId]) return false;

      spawnId = createSpawnId();
      spawns[chatId] = { cardId: card.cardId, spawnId, card };
      const caption = buildCardSpawnCaption(card, spawnId);
      await sendCardMedia(sock, chatId, card, caption);
      if (spawns[chatId]?.spawnId !== spawnId) return false;

      // Auto-expire
      const expireSpawn = () => {
        const active = spawns[chatId];
        if (active?.spawnId !== spawnId) return;
        if (isCardSpawnClaimReserved(active)) {
          setTimeout(expireSpawn, 1000);
          return;
        }
        delete spawns[chatId];
        sock.sendMessage(chatId, {
          text: `⏰ *${card.name}* was not claimed in time and vanished...`,
        }).catch(() => {});
      };
      setTimeout(expireSpawn, EXPIRE_MS);
      return true;

    } catch (err) {
      if (spawns[chatId]?.spawnId === spawnId) delete spawns[chatId];
      log("warn", `[autoSpawn] Failed to spawn in ${chatId}: ${err.message}`);
      return false;
    } finally {
      releaseCardSpawn(chatId);
    }
  }

  async function runSpawnCycle() {
    try {
      // Dynamically import getSocket to avoid circular-dep at load time
      const { getSocket } = await import("../../lib/bot.mjs");
      const sock = getSocket();
      if (!sock) return;

      const chats = await getEnabledSpawnChats();
      if (!chats.length) return;

      let spawned = 0;
      for (const chatId of chats) {
        if (await spawnCardInChat(sock, chatId)) spawned += 1;
      }

      log("info", `[autoSpawn] Spawned in ${spawned}/${chats.length} enabled chat(s)`);
    } catch (err) {
      log("warn", `[autoSpawn] Cycle error: ${err.message}`);
    }
  }

  // Start with a random 12–15 min interval, re-randomised each cycle
  function scheduleNext() {
    setTimeout(async () => { await runSpawnCycle(); scheduleNext(); }, randSpawnMs());
  }
  scheduleNext();
  log("info", "[autoSpawn] API-based card spawner initialised (12–15 min random)");
}

// Minimal plugin export — not a user-facing command
export default {
  name:        "_autospawn",
  description: "Internal: API card spawner",
  category:    "cards",
  run:         async () => {},
};
