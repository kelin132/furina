/**
 * KELIN MD — Pokémon trainer data (MongoDB)
 * Collection: pokemon_trainers
 */
import { getDb } from "../mongo.mjs";
import { normalizeJid } from "../identity.mjs";
import { trainerIdentityQuery } from "../collectionIdentity.mjs";
import { getPokemonCraftRecipe } from "./crafting.mjs";

function col() { return getDb().collection("pokemon_trainers"); }

const STARTER_INVENTORY = {
  pokeball: 3,
  greatball: 0,
  ultraball: 0,
  masterball: 0,
  premierball: 0,
  healball: 0,
  duskball: 0,
  netball: 0,
  potion: 3,
  superpotion: 0,
  hyperpotion: 0,
  fullrestore: 0,
  maxrevive: 0,
  revive: 0,
  xattack: 0,
  xdefense: 0,
  xspeed: 0,
  firestone: 0,
  waterstone: 0,
  thunderstone: 0,
  leafstone: 0,
  moonstone: 0,
  sunstone: 0,
  icestone: 0,
  shinystone: 0,
  dawnstone: 0,
  duskstone: 0,
  keystone: 0,
};

export async function getTrainer(jid) {
  const records = await col().find(await trainerIdentityQuery(jid)).toArray();
  if (!records.length) return null;
  records.sort((a, b) =>
    ((b.party?.length || 0) + (b.pc?.length || 0)) -
    ((a.party?.length || 0) + (a.pc?.length || 0)) ||
    String(a._id).localeCompare(String(b._id)));
  const primary = records[0];
  const party = [...new Set(records.flatMap((record) => (record.party || []).map(String)))];
  const pc = [...new Set(records.flatMap((record) => (record.pc || []).map(String)))]
    .filter((id) => !party.includes(id));
  return { ...primary, party, pc };
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function findTrainerByUsername(value) {
  const username = String(value ?? "").trim().replace(/^@+/, "");
  if (!username) return null;
  const matcher = { $regex: `^${escapeRegex(username)}$`, $options: "i" };
  const trainer = await col().findOne({ username: matcher });
  if (trainer) return getTrainer(trainer.jid);

  // A typed @handle is often the person's WhatsApp display name rather than
  // the trainer username saved when they started their journey.
  const user = await getDb().collection("users").findOne({
    $or: [
      { name: matcher },
      { username: matcher },
      { pushName: matcher },
      { notifyName: matcher },
    ],
  });
  if (!user?._id) return null;

  return getTrainer(String(user._id));
}

export async function createTrainer(jid, username) {
  const existing = await getTrainer(jid);
  if (existing) return existing;
  const id = normalizeJid(jid);
  const trainer = {
    jid: id,
    username,
    level: 1,
    xp: 0,
    coins: 1000,
    party: [],      // up to 6 pokemon _id strings
    pc: [],         // all other pokemon _id strings
    pokemonCount: 0,
    inventory: { ...STARTER_INVENTORY },
    wins: 0,
    losses: 0,
    badges: [],
    leadPokemonId: null,    // ID of the pokemon that goes first in every battle
    startedAt: new Date(),
  };
  await col().insertOne(trainer);
  return trainer;
}

export async function updateTrainer(jid, updates) {
  const trainer = await getTrainer(jid);
  if (!trainer) return;
  const update = Object.keys(updates).some((key) => key.startsWith("$"))
    ? updates
    : { $set: updates };
  await col().updateOne({ _id: trainer._id }, update);
}

export async function addCoins(jid, amount) {
  await updateTrainer(jid, { $inc: { coins: amount } });
}

export async function recordDailyPokemonWildWin(jid, nowMs = Date.now()) {
  const trainer = await getTrainer(jid);
  if (!trainer) return false;
  const day = new Date(nowMs).toISOString().slice(0, 10);
  await col().updateOne({ _id: trainer._id }, [
    {
      $set: {
        dailyQuest: {
          $cond: [
            { $eq: ["$dailyQuest.day", day] },
            "$dailyQuest",
            { day, wildWins: 0, claimed: false },
          ],
        },
      },
    },
    {
      $set: {
        "dailyQuest.wildWins": {
          $add: [{ $ifNull: ["$dailyQuest.wildWins", 0] }, 1],
        },
      },
    },
  ]);
  return true;
}

export async function claimDailyPokemonQuest(jid, nowMs = Date.now()) {
  const trainer = await getTrainer(jid);
  if (!trainer) return { ok: false, reason: "not-found" };
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const result = await col().updateOne(
    {
      _id: trainer._id,
      "dailyQuest.day": day,
      "dailyQuest.wildWins": { $gte: 1 },
      "dailyQuest.claimed": { $ne: true },
    },
    {
      $set: { "dailyQuest.claimed": true },
      $inc: {
        coins: 15_000,
        "inventory.apricorn": 3,
        "inventory.iron_ore": 1,
        "inventory.medicinal_herb": 2,
        "inventory.crystal_shard": 1,
      },
    },
  );
  if (result.modifiedCount !== 1) {
    const latest = await getTrainer(jid);
    return {
      ok: false,
      reason: latest?.dailyQuest?.day === day &&
        Number(latest.dailyQuest.wildWins) >= 1 &&
        latest.dailyQuest.claimed
        ? "already-claimed"
        : "incomplete",
    };
  }
  const xpResult = await addXP(jid, 100);
  return {
    ok: true,
    rewards: { coins: 15_000, xp: 100, items: 6 },
    leveledUp: Boolean(xpResult?.leveledUp),
  };
}

export async function craftPokemonItem(jid, recipeId) {
  const recipe = getPokemonCraftRecipe(recipeId);
  if (!recipe) return { ok: false, reason: "unknown-recipe" };
  const trainer = await getTrainer(jid);
  if (!trainer) return { ok: false, reason: "not-found" };
  const filter = { _id: trainer._id };
  const changes = {};
  for (const [item, quantity] of Object.entries(recipe.ingredients)) {
    filter[`inventory.${item}`] = { $gte: quantity };
    changes[`inventory.${item}`] = -quantity;
  }
  changes[`inventory.${recipe.output}`] =
    (changes[`inventory.${recipe.output}`] ?? 0) + recipe.quantity;
  const result = await col().updateOne(filter, { $inc: changes });
  return { ok: result.modifiedCount === 1, recipe };
}

export async function claimPokemonExploration(jid, nowMs = Date.now()) {
  const cooldownMs = 6 * 60 * 60 * 1000;
  const trainer = await getTrainer(jid);
  if (!trainer) return { ok: false, notFound: true, remainingMs: 0 };
  const lastStart = Number(trainer.lastFusionExploreAt || 0);
  const remainingMs = cooldownMs - (nowMs - lastStart);
  if (lastStart > 0 && remainingMs > 0) return { ok: false, remainingMs };
  const result = await col().updateOne(
    { _id: trainer._id, $or: [
      { lastFusionExploreAt: { $exists: false } },
      { lastFusionExploreAt: { $lte: nowMs - cooldownMs } },
    ] },
    { $set: { lastFusionExploreAt: nowMs } },
  );
  if (result.matchedCount > 0) return { ok: true, nextAt: nowMs + cooldownMs };
  const latest = await getTrainer(jid);
  const latestStart = Number(latest?.lastFusionExploreAt || nowMs);
  return { ok: false, remainingMs: Math.max(1, cooldownMs - (nowMs - latestStart)) };
}


export async function addItem(jid, item, qty = 1) {
  await updateTrainer(jid, { $inc: { [`inventory.${item}`]: qty } });
}

export async function removeItem(jid, item, qty = 1) {
  const trainer = await getTrainer(jid);
  if (!trainer) return false;
  const inventoryField = "inventory." + item;
  const result = await col().updateOne(
    { _id: trainer._id, [inventoryField]: { $gte: qty } },
    { $inc: { [inventoryField]: -qty } },
  );
  return result.modifiedCount > 0;
}
export async function hasItem(jid, item, qty = 1) {
  const trainer = await getTrainer(jid);
  return (trainer?.inventory?.[item] || 0) >= qty;
}

export async function addToParty(jid, pokemonId) {
  const id = normalizeJid(jid);
  const trainer = await getTrainer(id);
  if (!trainer) return false;
  if (trainer.party.length >= 6) return false;
  // Use $addToSet to prevent duplicate IDs if the same pokemon is added twice
  await col().updateOne({ _id: trainer._id }, { $addToSet: { party: pokemonId } });
  return true;
}

export async function removeFromParty(jid, pokemonId) {
  await col().updateMany(await trainerIdentityQuery(jid), { $pull: { party: pokemonId } });
}

export async function addToPC(jid, pokemonId) {
  await updateTrainer(jid, { $addToSet: { pc: pokemonId } });
}

export async function removeFromPC(jid, pokemonId) {
  await col().updateMany(await trainerIdentityQuery(jid), { $pull: { pc: pokemonId } });
}

/** Set which Pokémon goes first in battles */
export async function setLeadPokemonId(jid, pokemonId) {
  await updateTrainer(jid, { $set: { leadPokemonId: pokemonId?.toString() || null } });
}

/**
 * From an already-loaded party array, pick the Pokémon that can start a battle.
 *
 * A configured lead gets priority while it is healthy. If that lead has fainted,
 * use the next healthy Pokémon in party order. Never return a fainted Pokémon:
 * callers use null to tell the trainer to heal before battling.
 */
export function pickLeadFromParty(trainer, party = []) {
  // Sort the party by the trainer's party ID array so fallback order matches
  // the visible party order, even when MongoDB returns documents differently.
  const partyIdArr = trainer?.party || [];
  const loadedParty = Array.isArray(party) ? party : [];
  let orderedParty = loadedParty;
  if (partyIdArr.length > 0) {
    const idMap = {};
    for (const p of loadedParty) idMap[(p._id || p.id)?.toString()] = p;
    const sorted = partyIdArr.map(id => idMap[id?.toString()]).filter(Boolean);
    // Append any Pokémon not found in the ID array (safety fallback)
    for (const p of loadedParty) {
      const k = (p._id || p.id)?.toString();
      if (!sorted.some(x => (x._id || x.id)?.toString() === k)) sorted.push(p);
    }
    orderedParty = sorted;
  }

  const leadId = trainer?.leadPokemonId?.toString();
  const configuredLead = leadId
    ? orderedParty.find(p => (p._id || p.id)?.toString() === leadId)
    : null;

  // A fainted configured lead must not be returned as a 0-HP battle snapshot.
  return (
    (configuredLead && Number(configuredLead.hp) > 0 ? configuredLead : null) ||
    orderedParty.find(p => Number(p.hp) > 0) ||
    null
  );
}

export async function addXP(jid, amount) {
  const id = normalizeJid(jid);
  const trainer = await getTrainer(id);
  if (!trainer) return null;
  let xp = (trainer.xp || 0) + amount;
  let level = trainer.level || 1;
  let leveledUp = false;
  const xpNeeded = () => level * 100;
  while (xp >= xpNeeded()) {
    xp -= xpNeeded();
    level++;
    leveledUp = true;
  }
  await col().updateOne({ _id: trainer._id }, { $set: { xp, level } });
  return { leveledUp, newLevel: level, xp };
}
