import { pokemonFusionSpritePath } from "./media.mjs";

export const POKEMON_DESTINATIONS = [
  {
    "slug": "verdant-forest",
    "name": "Verdant Forest",
    "aliases": [
      "forest",
      "woods"
    ],
    "fusionIds": [
      1,
      8,
      9,
      10
    ]
  },
  {
    "slug": "crystal-lake",
    "name": "Crystal Lake",
    "aliases": [
      "lake",
      "crystal"
    ],
    "fusionIds": [
      2,
      4,
      11,
      16
    ]
  },
  {
    "slug": "ancient-ruins",
    "name": "Ancient Ruins",
    "aliases": [
      "ruins",
      "quarry"
    ],
    "fusionIds": [
      1,
      3,
      6,
      7,
      15
    ]
  },
  {
    "slug": "ember-mountain",
    "name": "Ember Mountain",
    "aliases": [
      "mountain",
      "volcano",
      "ember"
    ],
    "fusionIds": [
      5,
      12,
      13,
      14
    ]
  },
  {
    "slug": "moonlit-coast",
    "name": "Moonlit Coast",
    "aliases": [
      "coast",
      "harbor",
      "shore"
    ],
    "fusionIds": [
      2,
      4,
      8,
      11,
      16
    ]
  },
  {
    "slug": "sky-islands",
    "name": "Sky Islands",
    "aliases": ["sky", "islands", "clouds"],
    "fusionIds": [5, 8, 11, 14]
  },
  {
    "slug": "sunken-temple",
    "name": "Sunken Temple",
    "aliases": ["temple", "sunken", "underwater"],
    "fusionIds": [3, 7, 15, 16]
  },
  {
    "slug": "twilight-marsh",
    "name": "Twilight Marsh",
    "aliases": ["marsh", "swamp", "twilight"],
    "fusionIds": [1, 9, 10, 13]
  },
  {
    "slug": "coral-reef",
    "name": "Coral Reef",
    "aliases": ["reef", "coral"],
    "fusionIds": [2, 4, 6, 16]
  }
];
const FUSIONS = [
  {
    "id": 1,
    "name": "Obsidian Warden",
    "types": [
      "rock",
      "steel"
    ],
    "moves": [
      [
        "Ruin Pulse",
        "rock",
        135,
        "A shockwave from its ancient stone core."
      ],
      [
        "Ironfall",
        "steel",
        145,
        "A crushing rain of metallic fragments."
      ]
    ]
  },
  {
    "id": 2,
    "name": "Frostmane Stag",
    "types": [
      "ice",
      "dragon"
    ],
    "moves": [
      [
        "Glacier Rend",
        "ice",
        135,
        "A freezing antler strike."
      ],
      [
        "Winter Comet",
        "dragon",
        145,
        "A comet of blue dragonfire."
      ]
    ]
  },
  {
    "id": 3,
    "name": "Gilded Reaver",
    "types": [
      "steel",
      "dark"
    ],
    "moves": [
      [
        "Crown Judgment",
        "steel",
        140,
        "A royal strike backed by golden armor."
      ],
      [
        "Shadow Lance",
        "dark",
        150,
        "A piercing lance of shadow."
      ]
    ]
  },
  {
    "id": 4,
    "name": "Tidebreaker Drake",
    "types": [
      "water",
      "dragon"
    ],
    "moves": [
      [
        "Tidal Crush",
        "water",
        135,
        "A wave crashes down with draconic force."
      ],
      [
        "Scale Tempest",
        "dragon",
        145,
        "A storm of hardened scales."
      ]
    ]
  },
  {
    "id": 5,
    "name": "Cinderwing Dragon",
    "types": [
      "fire",
      "flying"
    ],
    "moves": [
      [
        "Inferno Wing",
        "fire",
        140,
        "Burning wings strike from above."
      ],
      [
        "Ashen Cyclone",
        "flying",
        145,
        "A hot whirlwind of ash and sparks."
      ]
    ]
  },
  {
    "id": 6,
    "name": "Glacier Sentinel",
    "types": [
      "ice",
      "rock"
    ],
    "moves": [
      [
        "Frost Prison",
        "ice",
        135,
        "Ice closes around the battlefield."
      ],
      [
        "Permafrost Slam",
        "rock",
        145,
        "A freezing slam from the glacier core."
      ]
    ]
  },
  {
    "id": 7,
    "name": "Silverblade Wyvern",
    "types": [
      "steel",
      "dragon"
    ],
    "moves": [
      [
        "Silver Eclipse",
        "steel",
        135,
        "A silver blade cuts through the light."
      ],
      [
        "Metal Tempest",
        "dragon",
        150,
        "A storm of spinning metal blades."
      ]
    ]
  },
  {
    "id": 8,
    "name": "Stormshadow Wolf",
    "types": [
      "dark",
      "electric"
    ],
    "moves": [
      [
        "Night Voltage",
        "electric",
        135,
        "Lightning flashes through the shadows."
      ],
      [
        "Shadow Fang",
        "dark",
        145,
        "A charged bite from the darkness."
      ]
    ]
  },
  {
    "id": 9,
    "name": "Verdant Shell Titan",
    "types": [
      "grass",
      "ground"
    ],
    "moves": [
      [
        "Worldroot Slam",
        "grass",
        135,
        "Ancient roots erupt beneath the target."
      ],
      [
        "Canopy Quake",
        "ground",
        145,
        "A forest-sized shockwave shakes the ground."
      ]
    ]
  },
  {
    "id": 10,
    "name": "Moonfang Prowler",
    "types": [
      "dark",
      "ice"
    ],
    "moves": [
      [
        "Phantom Rend",
        "dark",
        135,
        "A strike from an unseen prowler."
      ],
      [
        "Moonlit Frost",
        "ice",
        145,
        "A cold beam under the moonlight."
      ]
    ]
  },
  {
    "id": 11,
    "name": "Azure Gale Beast",
    "types": [
      "ice",
      "flying"
    ],
    "moves": [
      [
        "Blizzard Waltz",
        "ice",
        135,
        "A flowing dance of snow and ice."
      ],
      [
        "Gale Feathers",
        "flying",
        145,
        "Sharp feathers ride a freezing gale."
      ]
    ]
  },
  {
    "id": 12,
    "name": "Crimson Dreadknight",
    "types": [
      "bug",
      "steel"
    ],
    "moves": [
      [
        "Crimson Pincer",
        "bug",
        135,
        "A claw attack flashes crimson."
      ],
      [
        "Gear Break",
        "steel",
        145,
        "A grinding strike from armored limbs."
      ]
    ]
  },
  {
    "id": 13,
    "name": "Nightfire Raven",
    "types": [
      "dark",
      "fire"
    ],
    "moves": [
      [
        "Nightflare",
        "fire",
        135,
        "A dark flame erupts from its wings."
      ],
      [
        "Abyss Talon",
        "dark",
        145,
        "A talon strike from the abyss."
      ]
    ]
  },
  {
    "id": 14,
    "name": "Solar Circuit Serpent",
    "types": [
      "electric",
      "dragon"
    ],
    "moves": [
      [
        "Volt Spiral",
        "electric",
        135,
        "A spiral of concentrated electricity."
      ],
      [
        "Solar Fang",
        "dragon",
        145,
        "A blazing bite from a golden serpent."
      ]
    ]
  },
  {
    "id": 15,
    "name": "Gilded Iron Colossus",
    "types": [
      "steel",
      "ground"
    ],
    "moves": [
      [
        "Golden Quake",
        "ground",
        135,
        "A heavy blow sends golden shockwaves."
      ],
      [
        "Aegis Break",
        "steel",
        150,
        "A reinforced shield bash."
      ]
    ]
  },
  {
    "id": 16,
    "name": "Phantom Tide Dragon",
    "types": [
      "ghost",
      "water"
    ],
    "moves": [
      [
        "Phantom Current",
        "ghost",
        135,
        "A ghostly tide sweeps through the arena."
      ],
      [
        "Abyssal Wave",
        "water",
        145,
        "A wave rises from a shadowed sea."
      ]
    ]
  }
];

function normalize(value) {
  return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, " ").trim();
}

export function resolvePokemonDestination(value) {
  const query = normalize(value);
  if (!query) return null;
  return POKEMON_DESTINATIONS.find((destination, index) =>
    normalize(destination.name) === query || String(index + 1) === query ||
    normalize(destination.slug) === query || destination.aliases.some((alias) => normalize(alias) === query)
  ) || null;
}

export function createFusionPokemon(destination, random = Math.random) {
  const selectedDestination = typeof destination === "string" ? resolvePokemonDestination(destination) : destination;
  if (!selectedDestination) throw new Error("Unknown exploration destination.");
  const ids = selectedDestination.fusionIds;
  const profileIndex = Math.min(ids.length - 1, Math.floor(random() * ids.length));
  const profile = FUSIONS.find((fusion) => fusion.id === ids[profileIndex]);
  if (!profile) throw new Error("Fusion profile is missing.");
  const level = 50 + Math.min(40, Math.floor(random() * 41));
  const spritePath = pokemonFusionSpritePath(profile.id);
  const maxHp = 2200 + level * 16;
  return {
    id: "fusion-" + profile.id + "-" + Date.now(),
    name: profile.name,
    displayName: profile.name,
    pokedexId: 0,
    imageUrl: spritePath,
    imageLocalPath: spritePath,
    level,
    hp: maxHp,
    maxHp,
    attack: 340 + level * 3,
    defense: 190 + level * 1.2,
    speed: 110 + level * 2,
    types: [...profile.types],
    primaryType: profile.types[0],
    moves: profile.moves.map(([name, type, power, desc]) => ({ name, type, power, desc, pp: 8, accuracy: 95 })),
    location: selectedDestination.name,
    isFusionBoss: true,
    noCapture: true,
    shieldCharges: 3,
    maxShieldCharges: 3,
  };
}
