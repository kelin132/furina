import { getDb } from "../mongo.mjs";
import { normalizeJid } from "../identity.mjs";
import { trainerIdentityQuery } from "../collectionIdentity.mjs";
import { getTrainer, updateTrainer } from "./players.mjs";
import { utcDayKey, utcWeekKey } from "./seasonal.mjs";

export const DAILY_RESEARCH = [
  { id: "win", label: "Win 2 Pokémon battles", goal: 2, reward: 50000, xp: 1200 },
  { id: "catch", label: "Catch 2 Pokémon", goal: 2, reward: 50000, xp: 1200 },
  { id: "explore", label: "Explore once", goal: 1, reward: 50000, xp: 1200 },
  { id: "feed", label: "Bond with a Pokémon once", goal: 1, reward: 50000, xp: 1200 },
  { id: "raid", label: "Clear a co-op raid", goal: 1, reward: 50000, xp: 1200 },
];

function questCollection() {
  return getDb().collection("pokemon_daily_research");
}

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export async function getDailyResearch(jid, now = new Date()) {
  const trainerJid = normalizeJid(jid);
  const day = utcDayKey(now);
  const id = `${trainerJid}:${day}`;
  const mission = DAILY_RESEARCH[hashText(`${trainerJid}:${day}`) % DAILY_RESEARCH.length];
  await questCollection().updateOne(
    { _id: id },
    {
      $setOnInsert: {
        trainerJid,
        day,
        missionId: mission.id,
        progress: 0,
        claimed: false,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  const state = await questCollection().findOne({ _id: id });
  const assigned = DAILY_RESEARCH.find((item) => item.id === state?.missionId) || mission;
  return { ...state, mission: assigned, remaining: Math.max(0, assigned.goal - Number(state?.progress || 0)) };
}

export async function recordDailyProgress(jid, event, amount = 1, now = new Date()) {
  const state = await getDailyResearch(jid, now);
  if (state.mission.id !== event || state.claimed || amount <= 0) return state;
  await questCollection().updateOne(
    { _id: state._id, claimed: { $ne: true } },
    { $inc: { progress: Math.max(1, Math.floor(Number(amount) || 1)) } },
  );
  return getDailyResearch(jid, now);
}

export async function claimDailyResearch(jid, now = new Date()) {
  const state = await getDailyResearch(jid, now);
  if (state.claimed) return { ok: false, alreadyClaimed: true, state };
  if (Number(state.progress || 0) < state.mission.goal) {
    return { ok: false, incomplete: true, state };
  }
  const result = await questCollection().updateOne(
    { _id: state._id, claimed: { $ne: true }, progress: { $gte: state.mission.goal } },
    { $set: { claimed: true, claimedAt: now } },
  );
  if (result.modifiedCount !== 1) {
    return { ok: false, alreadyClaimed: true, state: await getDailyResearch(jid, now) };
  }
  return { ok: true, state };
}

export async function joinWeeklyTournament(jid, now = new Date()) {
  const trainer = await getTrainer(jid);
  if (!trainer) return false;
  const week = utcWeekKey(now);
  if (trainer.tournamentWeek === week) return true;
  await updateTrainer(jid, {
    tournamentWeek: week,
    tournamentWins: 0,
    tournamentJoinedAt: now,
  });
  return true;
}

export async function leaveWeeklyTournament(jid, now = new Date()) {
  const query = await trainerIdentityQuery(jid);
  await getDb().collection("pokemon_trainers").updateMany(
    { ...query, tournamentWeek: utcWeekKey(now) },
    { $unset: { tournamentWeek: "", tournamentWins: "", tournamentJoinedAt: "" } },
  );
}

export async function recordTournamentVictory(winnerJid, now = new Date()) {
  const query = await trainerIdentityQuery(winnerJid);
  const result = await getDb().collection("pokemon_trainers").updateMany(
    { ...query, tournamentWeek: utcWeekKey(now) },
    { $inc: { tournamentWins: 1 } },
  );
  return result.modifiedCount > 0;
}

export async function getWeeklyStandings(limit = 10, now = new Date()) {
  return getDb().collection("pokemon_trainers")
    .find({ tournamentWeek: utcWeekKey(now) }, {
      projection: { username: 1, tournamentWins: 1, tournamentJoinedAt: 1 },
    })
    .sort({ tournamentWins: -1, tournamentJoinedAt: 1 })
    .limit(Math.max(1, Math.min(20, limit)))
    .toArray();
}

export function getPokemonAchievements(trainer) {
  const badges = Array.isArray(trainer?.badges) ? trainer.badges.length : 0;
  const pokemon = Number(trainer?.pokemonCount || 0);
  const wins = Number(trainer?.wins || 0);
  const level = Number(trainer?.level || 1);
  return [
    { id: "first-catch", title: "First Partner", detail: "Own your first Pokémon", progress: pokemon, goal: 1 },
    { id: "collector", title: "Collector", detail: "Own 10 Pokémon", progress: pokemon, goal: 10 },
    { id: "battler", title: "Rising Battler", detail: "Win 10 battles", progress: wins, goal: 10 },
    { id: "champion", title: "Badge Hunter", detail: "Earn 5 gym badges", progress: badges, goal: 5 },
    { id: "veteran", title: "Veteran Trainer", detail: "Reach trainer level 25", progress: level, goal: 25 },
  ].map((item) => ({ ...item, unlocked: item.progress >= item.goal }));
}

export async function setPokemonTitle(jid, titleId) {
  const trainer = await getTrainer(jid);
  if (!trainer) return { ok: false, notFound: true };
  const achievement = getPokemonAchievements(trainer).find((item) => item.id === titleId);
  if (!achievement) return { ok: false, invalid: true };
  if (!achievement.unlocked) return { ok: false, locked: true, achievement };
  await updateTrainer(jid, { activePokemonTitle: achievement.title });
  return { ok: true, title: achievement.title };
}
