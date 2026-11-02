/**
 * KELIN MD — Pokémon Mart
 *
 * The mart catalogue is defined as a minimal list: inventory key, PokéAPI
 * slug, emoji, category, page, and buy-price.  Everything else — item names
 * and effect descriptions — is fetched live from the official PokéAPI
 * (https://pokeapi.co/api/v2/item/<slug>) and cached for 24 hours.
 *
 * MART_ITEMS is kept as a static export so bag.js and battle.js continue
 * to work without changes.  Its name/desc fields are derived from the API
 * slug as a best-effort fallback; the mart display always uses live API data.
 */

// ── PokéAPI fetch + cache ─────────────────────────────────────────────────────

const ITEM_API    = "https://pokeapi.co/api/v2/item";
const _apiCache   = new Map();                     // slug → { data, expiresAt }
const CACHE_TTL   = 24 * 60 * 60 * 1000;          // 24 hours

async function _fetchJson(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
    headers: { "User-Agent": "KelinMD-Bot/2.0" },
  });
  if (!res.ok) throw new Error(`PokéAPI ${res.status}`);
  return res.json();
}

function _extractEffect(raw) {
  const en = (raw.effect_entries || []).find(e => e.language?.name === "en");
  if (en?.short_effect) return en.short_effect.replace(/\n/g, " ").trim();
  if (en?.effect)       return en.effect.replace(/\n/g, " ").trim().slice(0, 140);
  const flavor = (raw.flavor_text_entries || []).find(e => e.language?.name === "en");
  if (flavor?.text)     return flavor.text.replace(/[\n\f]/g, " ").trim();
  return null;
}

function _slugToTitle(slug) {
  return slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Fetch one item from PokéAPI.  Returns { displayName, effect, apiCost }.
 * Returns null on any failure — callers fall back to static values.
 */
export async function fetchApiItem(slug) {
  const hit = _apiCache.get(slug);
  if (hit && Date.now() < hit.expiresAt) return hit.data;
  try {
    const raw  = await _fetchJson(`${ITEM_API}/${encodeURIComponent(slug)}`);
    const data = {
      displayName: _slugToTitle(raw.name || slug),
      effect:      _extractEffect(raw) || null,
      apiCost:     raw.cost ?? 0,
    };
    _apiCache.set(slug, { data, expiresAt: Date.now() + CACHE_TTL });
    return data;
  } catch {
    return null;
  }
}

// ── Minimal catalogue ─────────────────────────────────────────────────────────
// Only hardcoded fields: inventory key, PokéAPI slug, emoji, category, page,
// and the buy-price (API prices are unreliable — many items cost 0 in-game).

const CATALOGUE = [
  // Page 1 — Pokéballs
  { id: "pokeball",    slug: "poke-ball",    emoji: "⚪", category: "ball",    page: 1, price: 200   },
  { id: "greatball",   slug: "great-ball",   emoji: "🔵", category: "ball",    page: 1, price: 600   },
  { id: "ultraball",   slug: "ultra-ball",   emoji: "⚫", category: "ball",    page: 1, price: 1200  },
  { id: "masterball",  slug: "master-ball",  emoji: "🟣", category: "ball",    page: 1, price: 3500  },
  { id: "premierball", slug: "premier-ball", emoji: "⚪", category: "ball",    page: 1, price: 200   },
  { id: "healball",    slug: "heal-ball",    emoji: "🩷", category: "ball",    page: 1, price: 300   },
  { id: "duskball",    slug: "dusk-ball",    emoji: "🌑", category: "ball",    page: 1, price: 1000  },
  { id: "netball",     slug: "net-ball",     emoji: "🟩", category: "ball",    page: 1, price: 1000  },
  { id: "luxuryball",  slug: "luxury-ball",  emoji: "🟠", category: "ball",    page: 1, price: 1000  },
  { id: "quickball",   slug: "quick-ball",   emoji: "🟡", category: "ball",    page: 1, price: 1000  },
  { id: "beastball",   slug: "beast-ball",   emoji: "🔶", category: "ball",    page: 1, price: 12000 },

  // Page 2 — Healing items
  { id: "potion",       slug: "potion",        emoji: "🩹", category: "heal", page: 2, price: 300  },
  { id: "superpotion",  slug: "super-potion",  emoji: "💊", category: "heal", page: 2, price: 700  },
  { id: "hyperpotion",  slug: "hyper-potion",  emoji: "💉", category: "heal", page: 2, price: 1500 },
  { id: "fullrestore",  slug: "full-restore",  emoji: "✨", category: "heal", page: 2, price: 3000 },
  { id: "revive",       slug: "revive",        emoji: "💫", category: "heal", page: 2, price: 1500 },
  { id: "maxrevive",    slug: "max-revive",    emoji: "⭐", category: "heal", page: 2, price: 4000 },
  { id: "freshwater",   slug: "fresh-water",   emoji: "💧", category: "heal", page: 2, price: 200  },
  { id: "sodapop",      slug: "soda-pop",      emoji: "🥤", category: "heal", page: 2, price: 300  },
  { id: "lemonade",     slug: "lemonade",      emoji: "🍋", category: "heal", page: 2, price: 350  },
  { id: "moomoomilk",   slug: "moomoo-milk",   emoji: "🥛", category: "heal", page: 2, price: 500  },
  { id: "energypowder", slug: "energy-powder", emoji: "🌿", category: "heal", page: 2, price: 400  },
  { id: "energyroot",   slug: "energy-root",   emoji: "🌱", category: "heal", page: 2, price: 800  },

  // Page 3 — Battle items
  { id: "xattack",   slug: "x-attack",   emoji: "⚔️",  category: "battle", page: 3, price: 500  },
  { id: "xdefense",  slug: "x-defense",  emoji: "🛡️",  category: "battle", page: 3, price: 550  },
  { id: "xspeed",    slug: "x-speed",    emoji: "💨",  category: "battle", page: 3, price: 350  },
  { id: "xspatk",    slug: "x-sp-atk",  emoji: "🔮",  category: "battle", page: 3, price: 500  },
  { id: "xspdef",    slug: "x-sp-def",   emoji: "🔵",  category: "battle", page: 3, price: 550  },
  { id: "xaccuracy", slug: "x-accuracy", emoji: "🎯",  category: "battle", page: 3, price: 400  },
  { id: "guardspec", slug: "guard-spec", emoji: "🔒",  category: "battle", page: 3, price: 700  },
  { id: "direhit",   slug: "dire-hit",   emoji: "💥",  category: "battle", page: 3, price: 650  },

  // Page 4 — Evolution stones
  { id: "firestone",    slug: "fire-stone",    emoji: "🔥", category: "stone", page: 4, price: 3000 },
  { id: "waterstone",   slug: "water-stone",   emoji: "💧", category: "stone", page: 4, price: 3000 },
  { id: "thunderstone", slug: "thunder-stone", emoji: "⚡", category: "stone", page: 4, price: 3000 },
  { id: "leafstone",    slug: "leaf-stone",    emoji: "🍃", category: "stone", page: 4, price: 3000 },
  { id: "moonstone",    slug: "moon-stone",    emoji: "🌙", category: "stone", page: 4, price: 3000 },
  { id: "sunstone",     slug: "sun-stone",     emoji: "☀️", category: "stone", page: 4, price: 3000 },
  { id: "icestone",     slug: "ice-stone",     emoji: "🧊", category: "stone", page: 4, price: 3000 },
  { id: "shinystone",   slug: "shiny-stone",   emoji: "✨", category: "stone", page: 4, price: 4000 },
  { id: "dawnstone",    slug: "dawn-stone",    emoji: "🌅", category: "stone", page: 4, price: 4000 },
  { id: "duskstone",    slug: "dusk-stone",    emoji: "🌆", category: "stone", page: 4, price: 4000 },

  // Page 5 — Status cures
  { id: "antidote",     slug: "antidote",      emoji: "🟢", category: "cure", page: 5, price: 100 },
  { id: "paralyzeheal", slug: "paralyze-heal", emoji: "⚡", category: "cure", page: 5, price: 200 },
  { id: "awakening",    slug: "awakening",     emoji: "☀️", category: "cure", page: 5, price: 250 },
  { id: "burnheal",     slug: "burn-heal",     emoji: "🔥", category: "cure", page: 5, price: 250 },
  { id: "iceheal",      slug: "ice-heal",      emoji: "🧊", category: "cure", page: 5, price: 250 },
  { id: "fullheal",     slug: "full-heal",     emoji: "💚", category: "cure", page: 5, price: 600 },
  { id: "berryjuice",   slug: "berry-juice",   emoji: "🍒", category: "cure", page: 5, price: 100 },
  { id: "ragecandybar", slug: "rage-candy-bar",emoji: "🍫", category: "cure", page: 5, price: 350 },

  // Page 6 — Vitamins
  { id: "hpup",    slug: "hp-up",   emoji: "❤️",  category: "vitamin", page: 6, price: 5000 },
  { id: "protein", slug: "protein", emoji: "💪",  category: "vitamin", page: 6, price: 5000 },
  { id: "iron",    slug: "iron",    emoji: "🛡️",  category: "vitamin", page: 6, price: 5000 },
  { id: "calcium", slug: "calcium", emoji: "🔮",  category: "vitamin", page: 6, price: 5000 },
  { id: "zinc",    slug: "zinc",    emoji: "🔵",  category: "vitamin", page: 6, price: 5000 },
  { id: "carbos",  slug: "carbos",  emoji: "💨",  category: "vitamin", page: 6, price: 5000 },
  { id: "ppup",    slug: "pp-up",   emoji: "🔋",  category: "vitamin", page: 6, price: 3000 },
  { id: "ppmax",   slug: "pp-max",  emoji: "⚡",  category: "vitamin", page: 6, price: 9800 },

  // Page 7 — Key items
  { id: "keystone",    slug: "key-stone",   emoji: "💎", category: "key", page: 7, price: 15000 },
  { id: "luckyegg",    slug: "lucky-egg",   emoji: "🥚", category: "key", page: 7, price: 2500  },
  { id: "amuletcoin",  slug: "amulet-coin", emoji: "🪙", category: "key", page: 7, price: 3000  },
  { id: "smokeball",   slug: "smoke-ball",  emoji: "💨", category: "key", page: 7, price: 1200  },
  { id: "escaperope",  slug: "escape-rope", emoji: "🪢", category: "key", page: 7, price: 550   },
  { id: "rarecandy",   slug: "rare-candy",  emoji: "🍬", category: "key", page: 7, price: 4800  },
];

// ── Mega stones (page 8) ──────────────────────────────────────────────────────

const MEGA_CATALOGUE = [
  { id: "abomasite",     slug: "abomasite",      emoji: "❄️",  from: "Abomasnow",  to: "Mega Abomasnow"   },
  { id: "absolite",      slug: "absolite",        emoji: "🌑",  from: "Absol",      to: "Mega Absol"       },
  { id: "aerodactylite", slug: "aerodactylite",   emoji: "🦖",  from: "Aerodactyl", to: "Mega Aerodactyl"  },
  { id: "aggronite",     slug: "aggronite",       emoji: "⚙️",  from: "Aggron",     to: "Mega Aggron"      },
  { id: "alakazite",     slug: "alakazite",       emoji: "🥄",  from: "Alakazam",   to: "Mega Alakazam"    },
  { id: "altarianite",   slug: "altarianite",     emoji: "☁️",  from: "Altaria",    to: "Mega Altaria"     },
  { id: "ampharosite",   slug: "ampharosite",     emoji: "⚡",  from: "Ampharos",   to: "Mega Ampharos"    },
  { id: "audinite",      slug: "audinite",        emoji: "💗",  from: "Audino",     to: "Mega Audino"      },
  { id: "banettite",     slug: "banettite",       emoji: "👻",  from: "Banette",    to: "Mega Banette"     },
  { id: "beedrillite",   slug: "beedrillite",     emoji: "🐝",  from: "Beedrill",   to: "Mega Beedrill"    },
  { id: "blastoisinite", slug: "blastoisinite",   emoji: "💧",  from: "Blastoise",  to: "Mega Blastoise"   },
  { id: "blazikenite",   slug: "blazikenite",     emoji: "🔥",  from: "Blaziken",   to: "Mega Blaziken"    },
  { id: "cameruptite",   slug: "cameruptite",     emoji: "🌋",  from: "Camerupt",   to: "Mega Camerupt"    },
  { id: "charizarditex", slug: "charizardite-x",  emoji: "🐉",  from: "Charizard",  to: "Mega Charizard X" },
  { id: "charizarditey", slug: "charizardite-y",  emoji: "☀️",  from: "Charizard",  to: "Mega Charizard Y" },
  { id: "diancite",      slug: "diancite",        emoji: "💎",  from: "Diancie",    to: "Mega Diancie"     },
  { id: "galladite",     slug: "galladite",       emoji: "🗡️",  from: "Gallade",    to: "Mega Gallade"     },
  { id: "garchompite",   slug: "garchompite",     emoji: "🦈",  from: "Garchomp",   to: "Mega Garchomp"    },
  { id: "gardevoirite",  slug: "gardevoirite",    emoji: "🌸",  from: "Gardevoir",  to: "Mega Gardevoir"   },
  { id: "gengarite",     slug: "gengarite",       emoji: "👻",  from: "Gengar",     to: "Mega Gengar"      },
  { id: "glalitite",     slug: "glalitite",       emoji: "🧊",  from: "Glalie",     to: "Mega Glalie"      },
  { id: "gyaradosite",   slug: "gyaradosite",     emoji: "🌊",  from: "Gyarados",   to: "Mega Gyarados"    },
  { id: "heracronite",   slug: "heracronite",     emoji: "🪲",  from: "Heracross",  to: "Mega Heracross"   },
  { id: "houndoominite", slug: "houndoominite",   emoji: "🐺",  from: "Houndoom",   to: "Mega Houndoom"    },
  { id: "kangaskhanite", slug: "kangaskhanite",   emoji: "🦘",  from: "Kangaskhan", to: "Mega Kangaskhan"  },
  { id: "latiasite",     slug: "latiasite",       emoji: "🪽",  from: "Latias",     to: "Mega Latias"      },
  { id: "latiosite",     slug: "latiosite",       emoji: "🪽",  from: "Latios",     to: "Mega Latios"      },
  { id: "lopunnite",     slug: "lopunnite",       emoji: "🐰",  from: "Lopunny",    to: "Mega Lopunny"     },
  { id: "lucarionite",   slug: "lucarionite",     emoji: "🥊",  from: "Lucario",    to: "Mega Lucario"     },
  { id: "manectite",     slug: "manectite",       emoji: "⚡",  from: "Manectric",  to: "Mega Manectric"   },
  { id: "mawilite",      slug: "mawilite",        emoji: "🦷",  from: "Mawile",     to: "Mega Mawile"      },
  { id: "medichamite",   slug: "medichamite",     emoji: "🧘",  from: "Medicham",   to: "Mega Medicham"    },
  { id: "metagrossite",  slug: "metagrossite",    emoji: "🤖",  from: "Metagross",  to: "Mega Metagross"   },
  { id: "mewtwonitex",   slug: "mewtwonite-x",    emoji: "🧬",  from: "Mewtwo",     to: "Mega Mewtwo X"    },
  { id: "mewtwonitey",   slug: "mewtwonite-y",    emoji: "🧬",  from: "Mewtwo",     to: "Mega Mewtwo Y"    },
  { id: "pidgeotite",    slug: "pidgeotite",      emoji: "🦅",  from: "Pidgeot",    to: "Mega Pidgeot"     },
  { id: "pinsirite",     slug: "pinsirite",       emoji: "🪲",  from: "Pinsir",     to: "Mega Pinsir"      },
  { id: "sablenite",     slug: "sablenite",       emoji: "💎",  from: "Sableye",    to: "Mega Sableye"     },
  { id: "salamencite",   slug: "salamencite",     emoji: "🐲",  from: "Salamence",  to: "Mega Salamence"   },
  { id: "sceptilite",    slug: "sceptilite",      emoji: "🌿",  from: "Sceptile",   to: "Mega Sceptile"    },
  { id: "scizorite",     slug: "scizorite",       emoji: "✂️",  from: "Scizor",     to: "Mega Scizor"      },
  { id: "sharpedonite",  slug: "sharpedonite",    emoji: "🦈",  from: "Sharpedo",   to: "Mega Sharpedo"    },
  { id: "slowbronite",   slug: "slowbronite",     emoji: "🐚",  from: "Slowbro",    to: "Mega Slowbro"     },
  { id: "steelixite",    slug: "steelixite",      emoji: "🐍",  from: "Steelix",    to: "Mega Steelix"     },
  { id: "swampertite",   slug: "swampertite",     emoji: "💧",  from: "Swampert",   to: "Mega Swampert"    },
  { id: "tyranitarite",  slug: "tyranitarite",    emoji: "🦖",  from: "Tyranitar",  to: "Mega Tyranitar"   },
  { id: "venusaurite",   slug: "venusaurite",     emoji: "🌺",  from: "Venusaur",   to: "Mega Venusaur"    },
];

const PREMIUM_MEGA = new Set(["charizarditex","charizarditey","mewtwonitex","mewtwonitey"]);

for (const m of MEGA_CATALOGUE) {
  CATALOGUE.push({
    id:       m.id,
    slug:     m.slug,
    emoji:    m.emoji,
    category: "mega",
    page:     8,
    price:    PREMIUM_MEGA.has(m.id) ? 35000 : 25000,
    // fallback desc for bag.js (API will supply real text to the mart)
    _megaDesc: `Mega Evolves ${m.from} → ${m.to}. Requires an equipped Key Stone.`,
  });
}

// ── MART_ITEMS (backward-compat export for bag.js and battle.js) ──────────────
// Name is derived from the API slug; desc is a lightweight placeholder.
// The mart display (getMartPage) always uses the live API data instead.

export const MART_ITEMS = {};
CATALOGUE.push(
  { id: "moonball", slug: "moon-ball", emoji: "🌙", category: "ball", page: 9, price: 2800 },
  { id: "dreamball", slug: "dream-ball", emoji: "💭", category: "ball", page: 9, price: 2300 },
  { id: "cherishball", slug: "cherish-ball", emoji: "💖", category: "ball", page: 9, price: 4500 },
);

for (const item of CATALOGUE) {
  MART_ITEMS[item.id] = {
    name:     _slugToTitle(item.slug),
    price:    item.price,
    desc:     item._megaDesc || `See .mart page ${item.page} for details.`,
    category: item.category,
    emoji:    item.emoji,
    page:     item.page,
  };
}

// ── Page / index helpers ──────────────────────────────────────────────────────

export const PAGES = {};
for (const item of CATALOGUE) {
  const p = item.page;
  if (!PAGES[p]) PAGES[p] = [];
  PAGES[p].push(item);
}

export const PAGE_LABELS = {
  1: "🎾 POKÉBALLS",
  2: "💊 HEALING ITEMS",
  3: "⚔️  BATTLE ITEMS",
  4: "🪨 EVOLUTION STONES",
  5: "🩹 STATUS CURES",
  6: "💊 VITAMINS & BOOSTERS",
  7: "💎 KEY ITEMS & SPECIAL",
  8: "💠 MEGA EVOLUTION STONES",
  9: "🌙 SPECIAL POKÉBALLS",
};

export const TOTAL_PAGES = Object.keys(PAGES).length;

export const MART_ITEM_LIST = CATALOGUE.map(item => ({
  ...item,
  name: MART_ITEMS[item.id].name,
  desc: MART_ITEMS[item.id].desc,
}));

export function getItem(id)           { return MART_ITEMS[id] || null; }
export function getItemByIndex(index) { return MART_ITEM_LIST[index - 1] || null; }
export function getItemIndex(id) {
  const i = MART_ITEM_LIST.findIndex(it => it.id === id);
  return i === -1 ? null : i + 1;
}

export function getHealAmount(item) {
  const heals = {
    potion: 20, superpotion: 50, hyperpotion: 200, fullrestore: 9999,
    freshwater: 50, sodapop: 60, lemonade: 80, moomoomilk: 100,
    energypowder: 60, energyroot: 120, berryjuice: 20, ragecandybar: 999,
  };
  return heals[item] ?? 0;
}

/**
 * Build a formatted page for the mart with fully live API data.
 * Item names and descriptions are fetched from PokéAPI in parallel.
 * Falls back to slug-derived name / static desc when the API is unreachable.
 *
 * This function is async — callers must await it.
 */
export async function getMartPage(pageNum) {
  const items = PAGES[pageNum];
  if (!items || items.length === 0) return null;
  const label = PAGE_LABELS[pageNum] || `Page ${pageNum}`;

  // Fetch all items on this page from the API in parallel
  const apiResults = await Promise.all(items.map(item => fetchApiItem(item.slug)));

  const lines = items.map((item, i) => {
    const api  = apiResults[i];
    const name = api?.displayName || _slugToTitle(item.slug);
    const desc = api?.effect      || item._megaDesc || "No description available.";
    const idx  = getItemIndex(item.id);

    const useHint = item.category === "key" || item.category === "mega"
      ? item.id === "keystone"
        ? "\n    ↳ Use: `.equip <pokémon>`"
        : item.category === "mega"
          ? `\n    ↳ Use: \`.evolve <pokémon> ${item.id}\``
          : `\n    ↳ Use: \`.item use ${item.id}\``
      : "";

    return `  *${idx}.* ${item.emoji} *${name}* — ${item.price.toLocaleString()} coins\n    ↳ ${desc}${useHint}`;
  }).join("\n\n");

  return `*${label}*\n\n${lines}`;
}
