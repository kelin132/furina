/**
 * KELIN MD — Pokémon battle state (in-memory, per chat)
 * Supports both wild encounters and PvP challenges.
 */
import { randomBackTrainer, randomTrainerPair } from "./trainerSprites.mjs";
import { randomBattlefieldId } from "./battlefields.mjs";

const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes of inactivity
// chatId → battleState
const battles = new Map();
const BATTLE_WEATHER = Object.freeze([
  { id: "clear", name: "Clear Skies", icon: "☀️" },
  { id: "sun", name: "Harsh Sunlight", icon: "🌞" },
  { id: "rain", name: "Rain", icon: "🌧️" },
  { id: "sand", name: "Sandstorm", icon: "🌪️" },
  { id: "hail", name: "Hail", icon: "❄️" },
]);

function randomWeather() {
  return { ...BATTLE_WEATHER[Math.floor(Math.random() * BATTLE_WEATHER.length)] };
}

// pending PvP challenges: challengerId → { opponentJid, chatId, startedAt, pokemon }
const pendingChallenges = new Map();

export function getBattle(chatId) {
  const b = battles.get(chatId);
  if (!b) return null;
  if (Date.now() - b.lastAction > TIMEOUT_MS) {
    battles.delete(chatId);
    return null;
  }
  return b;
}

function comparableTrainerId(value) {
  const id = String(value ?? "").trim();
  if (!id) return "";
  if (id.startsWith("discord:")) return id;
  return id.replace(/:\d+(?=@)/, "");
}

/**
 * Find a live in-memory battle for a trainer across every chat.
 * `trainerIds` may include verified account aliases so WhatsApp/Discord
 * identity changes do not let a trainer heal from another group.
 */
export function getBattleForTrainer(trainerIds) {
  const ids = (Array.isArray(trainerIds) ? trainerIds : [trainerIds])
    .map(comparableTrainerId)
    .filter(Boolean);
  if (!ids.length) return null;

  const wanted = new Set(ids);
  for (const chatId of battles.keys()) {
    const battle = getBattle(chatId);
    if (!battle) continue;
    const participants = [
      battle.challengerJid,
      battle.opponentJid,
      battle.trainerJid,
    ].map(comparableTrainerId);
    if (participants.some((id) => id && wanted.has(id))) return battle;
  }
  return null;
}

/**
 * Start a wild Pokémon battle.
 * battler: { jid, username, pokemon }  — the trainer catching the wild
 * wild: the wild Pokémon object
 */
export function startWildBattle(chatId, battler, wild) {
  const state = {
    type: "wild",
    chatId,
    arenaId: randomBattlefieldId(),
    weather: randomWeather(),
    challengerJid: battler.jid,
    challengerName: battler.username,
    challengerTrainer: battler.trainerSprite || randomBackTrainer(),
    challengerPokemon: { ...battler.pokemon },
    opponentJid: null,
    opponentName: "Wild",
    opponentTrainer: null,
    opponentPokemon: { ...wild },
    turn: "challenger",
    round: 1,
    status: "active",
    lastAction: Date.now(),
    catchAttempts: 0,
  };
  battles.set(chatId, state);
  return state;
}

/**
 * Start a PvP battle.
 * challenger: { jid, username, pokemon }
 * opponent: { jid, username, pokemon }
 */
export function startPvPBattle(chatId, challenger, opponent) {
  const trainerPair = randomTrainerPair();
  const state = {
    type: "pvp",
    chatId,
    arenaId: randomBattlefieldId(),
    weather: randomWeather(),
    challengerJid: challenger.jid,
    challengerName: challenger.username,
    challengerTrainer: challenger.trainerSprite || trainerPair.challenger,
    challengerPokemon: { ...challenger.pokemon },
    opponentJid: opponent.jid,
    opponentName: opponent.username,
    opponentTrainer: opponent.trainerSprite || trainerPair.opponent,
    opponentPokemon: { ...opponent.pokemon },
    turn: "challenger", // challenger goes first
    round: 1,
    status: "active",
    lastAction: Date.now(),
  };
  battles.set(chatId, state);
  return state;
}

export function updateBattle(chatId, updates) {
  const b = battles.get(chatId);
  if (!b) return null;
  const updated = { ...b, ...updates, lastAction: Date.now() };
  battles.set(chatId, updated);
  return updated;
}

export function endBattle(chatId) {
  battles.delete(chatId);
}

export function hasBattle(chatId) {
  return !!getBattle(chatId);
}

export function isInBattle(chatId, jid) {
  const b = getBattle(chatId);
  if (!b) return false;
  return b.challengerJid === jid || b.opponentJid === jid;
}

export function isMyTurn(chatId, jid) {
  const b = getBattle(chatId);
  if (!b) return false;
  if (b.turn === "challenger" && b.challengerJid === jid) return true;
  if (b.turn === "opponent" && b.opponentJid === jid) return true;
  return false;
}

// ── PvP challenge queue ───────────────────────────────────────────────────────

export function setPendingChallenge(challengerJid, opponentJid, chatId, pokemon) {
  pendingChallenges.set(challengerJid, {
    opponentJid,
    chatId,
    startedAt: Date.now(),
    pokemon,
  });
}

export function getPendingChallenge(challengerJid) {
  const c = pendingChallenges.get(challengerJid);
  if (!c) return null;
  if (Date.now() - c.startedAt > 2 * 60 * 1000) { // 2 min timeout
    pendingChallenges.delete(challengerJid);
    return null;
  }
  return c;
}

export function getIncomingChallenge(opponentJid) {
  for (const [challenger, c] of pendingChallenges) {
    if (c.opponentJid === opponentJid && Date.now() - c.startedAt < 2 * 60 * 1000) {
      return { challengerJid: challenger, ...c };
    }
  }
  return null;
}

export function clearPendingChallenge(challengerJid) {
  pendingChallenges.delete(challengerJid);
}


export function claimBattleReward(chatId) {
  const battle = getBattle(chatId);
  if (!battle || battle.rewardClaimed) return false;
  updateBattle(chatId, { rewardClaimed: true });
  return true;
}
