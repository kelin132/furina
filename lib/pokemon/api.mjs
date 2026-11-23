/**
 * KELIN MD — Pokémon API wrapper
 *
 * Data priority:
 *  1. Local Pokémon data and sprites, when available.
 *  2. The configured Pokémon API.
 *  3. Official PokéAPI as a fallback for random encounters.
 */

import { readFile } from "fs/promises";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_ROOT = join(__dirname, "..", "..");

const LOCAL_DATA = join(BOT_ROOT, "data", "api", "v2", "pokemon");
const LOCAL_ART = join(
  BOT_ROOT,
  "sprites",
  "pokemon",
  "other",
  "official-artwork"
);
const LOCAL_FRONT = join(BOT_ROOT, "sprites", "pokemon");
const LOCAL_BACK = join(BOT_ROOT, "sprites", "pokemon", "back");

const API_ORIGIN = "https://pokeapi.eclipse.name.ng";
const BASE_URL = `${API_ORIGIN}/api/pokemon`;

const MAX_SPRITE_BYTES = 12 * 1024 * 1024;
const SPRITE_TIMEOUT_MS = 15000;
const SPRITE_CDN_BASE =
  "https://cdn.jsdelivr.net/gh/PokeAPI/sprites@master/sprites/pokemon";

const cache = new Map();
const CACHE_TTL = 60 * 60 * 1000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, {
    data,
    expiresAt: Date.now() + CACHE_TTL,
  });
}

/** Read and parse a local JSON file. Returns null if unavailable or invalid. */
async function readLocalJson(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Find a local front sprite for a Pokédex ID. */
async function findLocalSprite(id) {
  const artPath = join(LOCAL_ART, `${id}.png`);

  try {
    await readFile(artPath);
    return artPath;
  } catch {
    // Try the regular front sprite.
  }

  const frontPath = join(LOCAL_FRONT, `${id}.png`);

  try {
    await readFile(frontPath);
    return frontPath;
  } catch {
    return null;
  }
}

/** Find a local back sprite for a Pokédex ID. */
async function findLocalBackSprite(id) {
  const backPath = join(LOCAL_BACK, `${id}.png`);

  try {
    await readFile(backPath);
    return backPath;
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: {
      "User-Agent": "KelinMD-Bot/2.0",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Pokémon API error ${response.status} for ${url}`
    );
  }

  return response.json();
}

/** Convert a provider response into the Pokémon object used by the bot. */
export function normalizePokemon(raw) {
  if (!raw) {
    throw new Error("Empty Pokémon response");
  }

  const getStat = (name) => {
    if (Array.isArray(raw.stats)) {
      const stat = raw.stats.find(
        (item) => (item.stat?.name || item.name) === name
      );

      return stat
        ? stat.base_stat ?? stat.value ?? 10
        : 10;
    }

    if (raw.stats && typeof raw.stats === "object") {
      return raw.stats[name] ?? 10;
    }

    return 10;
  };

  let types = [];

  if (Array.isArray(raw.types)) {
    types = raw.types
      .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
      .map((item) =>
        typeof item === "string"
          ? item
          : item.type?.name ?? item.name ?? "normal"
      );
  } else if (typeof raw.type === "string") {
    types = [raw.type];
  } else {
    types = ["normal"];
  }

  const pokedexId = raw.id ?? raw.pokedexId;

  const frontSpriteUrl =
    resolveApiImageUrl(raw.sprites?.front_default || raw.frontSpriteUrl) ||
    (pokedexId ? `${SPRITE_CDN_BASE}/${pokedexId}.png` : null);

  const imageUrl =
    resolveApiImageUrl(
      raw.sprites?.other?.["official-artwork"]?.front_default
    ) ||
    resolveApiImageUrl(raw.imageUrl || raw.image) ||
    frontSpriteUrl ||
    (pokedexId
      ? `${SPRITE_CDN_BASE}/other/official-artwork/${pokedexId}.png`
      : null);

  const backSpriteUrl =
    resolveApiImageUrl(raw.sprites?.back_default || raw.backSpriteUrl) ||
    (pokedexId ? `${SPRITE_CDN_BASE}/back/${pokedexId}.png` : null);

  const backImageUrl =
    backSpriteUrl ||
    resolveApiImageUrl(raw.backImage) ||
    (pokedexId ? `${SPRITE_CDN_BASE}/back/${pokedexId}.png` : null);

  return {
    pokedexId: pokedexId ?? 1,
    name: (raw.name || "unknown").toLowerCase().replace(/-/g, " "),
    displayName: capitalize(raw.name || "Unknown"),
    types,
    primaryType: types[0] || "normal",
    baseHp: getStat("hp"),
    baseAttack: getStat("attack"),
    baseDefense: getStat("defense"),
    baseSpeed: getStat("speed"),
    baseSpAtk: getStat("special-attack"),
    imageUrl,
    backImageUrl,
    frontSpriteUrl,
    backSpriteUrl,
    imageLocalPath: null,
    backImageLocalPath: null,
    height: raw.height ?? 10,
    weight: raw.weight ?? 100,
  };
}

function resolveApiImageUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return new URL(value, `${API_ORIGIN}/`).toString();
  } catch {
    return null;
  }
}

function spriteCandidates(id, back = false) {
  if (!Number.isInteger(id) || id <= 0) {
    return [];
  }

  if (back) {
    return [
      `${SPRITE_CDN_BASE}/back/${id}.png`,
      `https://raw.githack.com/PokeAPI/sprites/master/sprites/pokemon/back/${id}.png`,
    ];
  }

  return [
    `${SPRITE_CDN_BASE}/other/official-artwork/${id}.png`,
    `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${String(
      id
    ).padStart(3, "0")}.png`,
    `https://raw.githack.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
  ];
}

function capitalize(value) {
  return (
    value.charAt(0).toUpperCase() +
    value.slice(1).replace(/-/g, " ")
  );
}

async function readRemoteSprite(url) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(SPRITE_TIMEOUT_MS),
      headers: {
        Accept:
          "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "User-Agent": "KelinMD-Bot/2.0",
      },
    });

    if (!response.ok) {
      return null;
    }

    const contentType = String(
      response.headers.get("content-type") || ""
    ).toLowerCase();

    if (contentType && !contentType.startsWith("image/")) {
      return null;
    }

    const declaredLength = Number(
      response.headers.get("content-length") || 0
    );

    if (declaredLength > MAX_SPRITE_BYTES) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (!buffer.length || buffer.length > MAX_SPRITE_BYTES) {
      return null;
    }

    return buffer;
  } catch {
    return null;
  }
}

async function imagePayload(localPath, urls) {
  if (localPath) {
    try {
      const buffer = await readFile(localPath);

      if (buffer.length) {
        return { image: buffer };
      }
    } catch {
      // Try remote image URLs.
    }
  }

  for (const url of [...new Set(urls.filter(Boolean))]) {
    const buffer = await readRemoteSprite(url);

    if (buffer) {
      return { image: buffer };
    }
  }

  return null;
}

/** Return a Pokémon image payload suitable for sock.sendMessage. */
export async function getImageMessage(pokemon) {
  const id = Number(pokemon?.pokedexId);

  return imagePayload(
    pokemon?.imageLocalPath,
    [
      pokemon?.imageUrl,
      pokemon?.frontSpriteUrl,
      ...spriteCandidates(id),
    ]
  );
}

/** Return a Pokémon back-sprite payload suitable for battles. */
export async function getBackImageMessage(pokemon) {
  const id = Number(pokemon?.pokedexId);

  return imagePayload(
    pokemon?.backImageLocalPath,
    [
      pokemon?.backImageUrl,
      pokemon?.backSpriteUrl,
      ...spriteCandidates(id, true),
    ]
  );
}

function nameCacheKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

/** Fetch a Pokémon by Pokédex ID, using local data when available. */
export async function fetchById(id) {
  const key = `id:${id}`;
  const cached = cacheGet(key);

  if (cached) {
    return cached;
  }

  const localRaw = await readLocalJson(
    join(LOCAL_DATA, String(id), "index.json")
  );

  if (localRaw) {
    const data = normalizePokemon(localRaw);
    data.imageLocalPath = await findLocalSprite(id);
    data.backImageLocalPath = await findLocalBackSprite(id);

    cacheSet(key, data);
    cacheSet(`name:${nameCacheKey(data.name)}`, data);

    return data;
  }

  const raw = await fetchJson(`${BASE_URL}/${id}`);
  const data = normalizePokemon(raw);

  cacheSet(key, data);
  cacheSet(`name:${nameCacheKey(data.name)}`, data);

  return data;
}

/** Fetch a Pokémon by name, including supported mega variants. */
export async function fetchByName(name) {
  const normalized = String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

  const