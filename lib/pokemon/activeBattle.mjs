import { getDb } from "../mongo.mjs";
import { accountIdentityValues } from "../collectionIdentity.mjs";
import { getBattleForTrainer } from "./battleState.mjs";

const WEB_BATTLE_IDLE_MS = 2 * 60 * 1000;

function comparableTrainerId(value) {
  const id = String(value ?? "").trim();
  if (!id) return "";
  if (id.startsWith("discord:")) return id;
  return id.replace(/:\d+(?=@)/, "");
}

export function isLiveWebBattleForTrainer(room, trainerIds, now = Date.now()) {
  if (!room || room.status !== "active") return false;
  const ids = new Set((Array.isArray(trainerIds) ? trainerIds : [trainerIds])
    .map(comparableTrainerId)
    .filter(Boolean));
  if (!ids.size) return false;

  const participants = [room.challenger?.id, room.opponent?.id]
    .map(comparableTrainerId)
    .filter(Boolean);
  if (!participants.some((id) => ids.has(id))) return false;

  const expiresAt = room.expiresAt ? new Date(room.expiresAt).getTime() : null;
  if (expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= now) return false;
  const lastActionAt = room.lastActionAt || room.createdAt;
  const lastAction = lastActionAt ? new Date(lastActionAt).getTime() : 0;
  return Number.isFinite(lastAction) && now - lastAction < WEB_BATTLE_IDLE_MS;
}

/**
 * Find a trainer's live Pokémon battle across every bot chat and the website.
 * Database failures are allowed to propagate so callers can fail closed
 * instead of accidentally healing during an unverified web battle.
 */
export async function findActivePokemonBattle(trainerJid) {
  const resolvedIds = await accountIdentityValues(trainerJid);
  const ids = [...new Set([trainerJid, ...resolvedIds]
    .map(comparableTrainerId)
    .filter(Boolean))];

  const localBattle = getBattleForTrainer(ids);
  if (localBattle) return { source: "chat", battle: localBattle };

  const roomFilter = {
    status: "active",
    $or: [
      { "challenger.id": { $in: ids } },
      { "opponent.id": { $in: ids } },
    ],
  };
  const rooms = await getDb().collection("web_battle_rooms").find(roomFilter).toArray();
  const webBattle = rooms.find((room) => isLiveWebBattleForTrainer(room, ids));
  return webBattle ? { source: "web", battle: webBattle } : null;
}
