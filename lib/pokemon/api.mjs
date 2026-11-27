/** Eula PokéAPI adapter. Saved trainer/game state remains in MongoDB. */
import { readFile } from "node:fs/promises";

export const API_ORIGIN = "https://pokeapi.eulaorg.app";
const cache = new Map();
const TTL = 60 * 60 * 1000;
const key = value => String(value).trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export async function fetchApiResource(resource, query) {
  if (!["pokemon", "items", "moves", "abilities"].includes(resource)) throw new Error("Invalid resource");
  const lookup = String(query).trim().toLowerCase().replace(/\s+/g, "-");
  const path = `/api/${resource}/${encodeURIComponent(lookup)}${resource === "pokemon" ? "/all" : ""}`;
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.data;
  const res = await fetch(`${API_ORIGIN}${path}`, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`Pokémon API error ${res.status}`);
  const data = await res.json();
  if (!data || data.error) throw new Error(data?.error || "Empty Pokémon response");
  if (cache.size >= 2048) cache.delete(cache.keys().next().value);
  cache.set(path, { data, expires: Date.now() + TTL });
  return data;
}

export function spriteUrl(id, back = false, shiny = false, form = 0) {
  return `${API_ORIGIN}/api/sprites/${encodeURIComponent(id)}?variant=${back ? "back" : "front"}${shiny ? "-shiny" : ""}${form ? `&form=${form}` : ""}`;
}

/** Accepts Eula responses (and legacy records for existing callers/tests). */
export function normalizePokemon(raw) {
  if (!raw || raw.error || !(raw.id ?? raw.pokedexId)) throw new Error("Invalid Pokémon response");
  const id = Number(raw.id ?? raw.pokedexId);
  const stat = (legacy, current) => raw.BaseStats?.[current] ??
    (Array.isArray(raw.stats) ? raw.stats.find(s => (s.stat?.name ?? s.name) === legacy)?.base_stat : raw.stats?.[legacy]) ?? 10;
  const types = (raw.Types ?? raw.types ?? [raw.type || "normal"]).map(t =>
    String(typeof t === "string" ? t : t.type?.name ?? t.name).toLowerCase());
  const name = raw.FormName || raw.Name || raw.name || "Unknown";
  const front = spriteUrl(id, false, false, raw.form);
  const back = spriteUrl(id, true, false, raw.form);
  return {
    pokedexId: id,
    name: name.toLowerCase().replace(/-/g, " "),
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    types, primaryType: types[0] || "normal",
    baseHp: stat("hp", "hp"), baseAttack: stat("attack", "attack"),
    baseDefense: stat("defense", "defense"), baseSpeed: stat("speed", "speed"),
    baseSpAtk: stat("special-attack", "specialAttack"),
    baseSpDef: stat("special-defense", "specialDefense"),
    imageUrl: front, frontSpriteUrl: front, backImageUrl: back, backSpriteUrl: back,
    imageLocalPath: null, backImageLocalPath: null,
    // Existing commands expect decimetres/hectograms, Eula supplies m/kg.
    height: raw.Height != null ? raw.Height * 10 : raw.height ?? 10,
    weight: raw.Weight != null ? raw.Weight * 10 : raw.weight ?? 100,
    abilities: raw.Abilities ?? [], hiddenAbilities: raw.HiddenAbilities ?? [],
    moves: raw.Moves ?? [], moveDetails: raw.moveDetails ?? [],
    evolutions: raw.Evolutions ?? [], forms: raw.forms ?? [],
    description: raw.Pokedex ?? "", form: raw.form ?? 0,
  };
}

export async function fetchById(id) {
  if (!Number.isInteger(Number(id)) || Number(id) < 1) throw new Error("Invalid Pokédex ID");
  return normalizePokemon(await fetchApiResource("pokemon", Number(id)));
}

export async function fetchByName(name) {
  const query = String(name).trim().toLowerCase().replace(/\s+/g, "-");
  if (!query) throw new Error("Provide a Pokémon name");
  try {
    return normalizePokemon(await fetchApiResource("pokemon", query));
  } catch (error) {
    if (!error.message.includes("404")) throw error;
  }
  // Eula stores alternate forms under their base species, not PokeAPI form IDs.
  const match = query.match(/^mega-(.+?)(?:-(x|y))?$/) ||
    query.match(/^(.+?)-mega(?:-(x|y))?$/);
  if (match) {
    const raw = await fetchApiResource("pokemon", match[1]);
    const expected = key(`mega ${match[1]} ${match[2] || ""}`);
    const form = raw.forms?.find(f => key(f.FormName) === expected);
    if (form) return normalizePokemon({ ...raw, ...form, id: raw.id });
  }
  throw new Error(`No Pokémon found for "${name}"`);
}

export async function fetchRandom() {
  return fetchById(1 + Math.floor(Math.random() * 1025));
}

export function fetchPokemon(query) {
  return /^\d+$/.test(String(query)) ? fetchById(Number(query)) : fetchByName(query);
}

async function imagePayload(pokemon, back) {
  const local = back ? pokemon?.backImageLocalPath : pokemon?.imageLocalPath;
  if (local) {
    try { return { image: await readFile(local) }; } catch { /* fetch Eula sprite */ }
  }
  const id = Number(pokemon?.pokedexId);
  if (!Number.isInteger(id) || id < 1) return null;
  try {
    const response = await fetch(spriteUrl(id, back, Boolean(pokemon.shiny), pokemon.form), {
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) return null;
    if (Number(response.headers.get("content-length")) > 12 * 1024 * 1024) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.length && buffer.length <= 12 * 1024 * 1024 ? { image: buffer } : null;
  } catch { return null; }
}

export const getImageMessage = pokemon => imagePayload(pokemon, false);
export const getBackImageMessage = pokemon => imagePayload(pokemon, true);
