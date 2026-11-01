/**
 * KELIN MD — Individual Pokémon storage (MongoDB)
 * Collection: pokemon_owned
 */
import { getDb } from "../mongo.mjs";
import { ObjectId } from "mongodb";
import { normalizeJid } from "../identity.mjs";
import { pokemonOwnershipQuery } from "../collectionIdentity.mjs";
import { updateTrainer } from "./players.mjs";
import { TYPE_MOVES, getMovesForType } from "./gameLogic.mjs";

function col() { return getDb().collection("pokemon_owned"); }

export const MAX_POKEMON_LEVEL = 100;

/**
 * XP needed to advance from the supplied level to the next level.
 * Early levels stay quick, while the curve becomes substantially steeper
 * from level 50 onward so reaching level 100 remains an achievement.
 */
export function getPokemonXpNeeded(level) {
  const currentLevel = Math.max(1, Math.floor(Number(level) || 1));
  if (currentLevel >= MAX_POKEMON_LEVEL) return 0;
  return Math.floor(80 + (currentLevel * 20) + (8 * Math.pow(currentLevel, 1.8)));
}

/** Scale base stats to a given level */
function scaleStats(base, level) {
  return Math.floor(base * (1 + level * 0.05));
}

/** Build a Pokémon document from API data + level */
export function buildPokemon(apiData, ownerJid, level = 5, inParty = false) {
  const hp = Math.max(10, scaleStats(apiData.baseHp, level));
  const id = normalizeJid(ownerJid);
  return {
    _id: new ObjectId(),
    ownerJid: id,
    pokedexId: apiData.pokedexId,
    name: apiData.name,
    displayName: apiData.displayName,
    nickname: null,
    level,
    xp: 0,
    xpNeeded: getPokemonXpNeeded(level),
    hp,
    maxHp: hp,
    attack: Math.max(5, scaleStats(apiData.baseAttack, level)),
    defense: Math.max(5, scaleStats(apiData.baseDefense, level)),
    speed: Math.max(5, scaleStats(apiData.baseSpeed, level)),
    spAtk: Math.max(5, scaleStats(apiData.baseSpAtk, level)),
    types: apiData.types,
    primaryType: apiData.primaryType,
    imageUrl: apiData.imageUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${apiData.pokedexId}.png`,
    backImageUrl: apiData.backImageUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${apiData.pokedexId}.png`,
    frontSpriteUrl: apiData.frontSpriteUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${apiData.pokedexId}.png`,
    backSpriteUrl: apiData.backSpriteUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${apiData.pokedexId}.png`,
    moves: getMovesForType(apiData.primaryType, apiData.types, level),
    shiny: Math.random() < 0.005, // 0.5% shiny chance
    inParty,
    isStarter: false, // set to true for the trainer's chosen starter (cannot give away or sell)
    caughtAt: new Date(),
    height: apiData.height,
    weight: apiData.weight,
  };
}

export async function savePokemon(pokemon) {
  await col().insertOne(pokemon);
  const ownerJid = normalizeJid(pokemon.ownerJid);
  if (ownerJid) {
    await updateTrainer(ownerJid, { $inc: { pokemonCount: 1 } });
  }
  return pokemon;
}

export async function getPokemon(id) {
  const _id = typeof id === "string" ? ObjectId.createFromHexString(id) : id;
  return col().findOne({ _id });
}

export async function getTrainerParty(ownerJid) {
  return col().find({ ...(await pokemonOwnershipQuery(ownerJid)), inParty: true }).toArray();
}

export async function getTrainerPC(ownerJid) {
  return col().find({ ...(await pokemonOwnershipQuery(ownerJid)), inParty: { $ne: true } }).toArray();
}

export async function getAllTrainerPokemon(ownerJid) {
  return col().find(await pokemonOwnershipQuery(ownerJid)).toArray();
}

export async function countTrainerPokemon(ownerJid) {
  return col().countDocuments(await pokemonOwnershipQuery(ownerJid));
}

export async function updatePokemon(id, updates) {
  const _id = typeof id === "string" ? ObjectId.createFromHexString(id) : id;
  await col().updateOne({ _id }, { $set: updates });
}

export async function healPokemon(id) {
  const pokemon = await getPokemon(id);
  if (!pokemon) return;
  await col().updateOne({ _id: pokemon._id }, { $set: { hp: pokemon.maxHp } });
}

export async function healPartyAndGet(ownerJid) {
  const id = normalizeJid(ownerJid);
  const party = await getTrainerParty(id);
  if (!party.length) return [];

  // Heal the complete party in one MongoDB bulk request instead of awaiting
  // one network round trip per Pokémon, then return refreshed snapshots so
  // callers do not need a second getTrainerParty query.
  await col().bulkWrite(
    party.map((pokemon) => ({
      updateOne: {
        filter: { _id: pokemon._id },
        update: { $set: { hp: pokemon.maxHp } },
      },
    })),
    { ordered: false },
  );

  return party.map((pokemon) => ({ ...pokemon, hp: pokemon.maxHp }));
}

export async function healParty(ownerJid) {
  return (await healPartyAndGet(ownerJid)).length;
}

export async function evolvePokemon(id, newApiData) {
  const pokemon = await getPokemon(id);
  if (!pokemon) return null;
  const newHp = Math.max(10, Math.floor(newApiData.baseHp * (1 + pokemon.level * 0.05)));
  // Preserve HP ratio on evolution so a fainted Pokémon stays fainted
  // and a healthy one keeps its proportional HP rather than getting a free full heal.
  const hpRatio = pokemon.maxHp > 0 ? (pokemon.hp || 0) / pokemon.maxHp : 1;
  const evolvedHp = Math.max(0, Math.floor(hpRatio * newHp));
  const updates = {
    pokedexId: newApiData.pokedexId,
    name: newApiData.name,
    displayName: newApiData.displayName,
    types: newApiData.types,
    primaryType: newApiData.primaryType,
    imageUrl: newApiData.imageUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${newApiData.pokedexId}.png`,
    backImageUrl: newApiData.backImageUrl ||
      `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${newApiData.pokedexId}.png`,
    hp: evolvedHp,
    maxHp: newHp,
    attack: Math.max(5, Math.floor(newApiData.baseAttack * (1 + pokemon.level * 0.05))),
    defense: Math.max(5, Math.floor(newApiData.baseDefense * (1 + pokemon.level * 0.05))),
    speed: Math.max(5, Math.floor(newApiData.baseSpeed * (1 + pokemon.level * 0.05))),
    moves: getMovesForType(newApiData.primaryType, newApiData.types, pokemon.level),
  };
  await col().updateOne({ _id: pokemon._id }, { $set: updates });
  return { ...pokemon, ...updates };
}

export async function deletePokemon(id) {
  const _id = typeof id === "string" ? ObjectId.createFromHexString(id) : id;
  await col().deleteOne({ _id });
}

export async function addPokemonXP(id, amount) {
  const pokemon = await getPokemon(id);
  if (!pokemon) return null;
  let xp = Math.max(0, (pokemon.xp || 0) + Math.max(0, Number(amount) || 0));
  let level = Math.max(1, Math.floor(pokemon.level || 1));
  let leveledUp = false;
  while (level < MAX_POKEMON_LEVEL) {
    const needed = getPokemonXpNeeded(level);
    if (xp < needed) break;
    xp -= needed;
    level++;
    leveledUp = true;
  }
  const xpNeeded = getPokemonXpNeeded(level);
  if (level >= MAX_POKEMON_LEVEL) xp = 0;
  // Scale stats on level up
  const updates = { xp, xpNeeded, level };
  if (leveledUp) {
    const newHp = Math.max(10, Math.floor((pokemon.maxHp / (1 + pokemon.level * 0.05)) * (1 + level * 0.05)));
    updates.maxHp = newHp;
    // Keep current HP as-is on level up — do NOT restore to full during battle.
    // Cap at new maxHp just in case, but never raise it.
    updates.hp = Math.min(pokemon.hp ?? newHp, newHp);
    updates.attack = Math.max(5, Math.floor((pokemon.attack / (1 + pokemon.level * 0.05)) * (1 + level * 0.05)));
    updates.defense = Math.max(5, Math.floor((pokemon.defense / (1 + pokemon.level * 0.05)) * (1 + level * 0.05)));
    updates.speed = Math.max(5, Math.floor((pokemon.speed / (1 + pokemon.level * 0.05)) * (1 + level * 0.05)));
  }
  await col().updateOne({ _id: pokemon._id }, { $set: updates });
  return { leveledUp, newLevel: level, pokemon: { ...pokemon, ...updates } };
}
