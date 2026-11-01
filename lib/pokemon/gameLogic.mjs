/**
 * KELIN MD — Pokémon game logic
 * Battle calculations, catch rates, moves, type effectiveness
 */

// ── Move pools by type (8 moves each: first 6 are starter moves, 7-8 are level-up learnable) ─────
export const TYPE_MOVES = {
  fire: [
    { name:"Ember",         pp:25, power:40,  accuracy:100, type:"fire",     desc:"A weak flaming attack. May leave the foe with a burn." },
    { name:"Flame Wheel",   pp:25, power:60,  accuracy:100, type:"fire",     desc:"The user rolls wrapped in flames, crashing into the foe." },
    { name:"Fire Spin",     pp:15, power:35,  accuracy:85,  type:"fire",     desc:"Traps the foe inside a whirling vortex of fire for 2–5 turns." },
    { name:"Flamethrower",  pp:15, power:95,  accuracy:100, type:"fire",     desc:"A powerful stream of fire that may inflict a burn." },
    { name:"Heat Wave",     pp:10, power:95,  accuracy:90,  type:"fire",     desc:"Scorching hot air is blasted at the foe. May leave a burn." },
    { name:"Fire Blast",    pp:5,  power:120, accuracy:85,  type:"fire",     desc:"A massive explosion of fire. High chance of leaving a burn." },
    { name:"Overheat",      pp:5,  power:130, accuracy:90,  type:"fire",     desc:"An overwhelming heat attack. Sharply lowers Sp. Atk after." },
    { name:"Blast Burn",    pp:5,  power:150, accuracy:90,  type:"fire",     desc:"The ultimate fire move. The user must rest after using it." },
  ],
  water: [
    { name:"Water Gun",     pp:25, power:40,  accuracy:100, type:"water",    desc:"The foe is attacked with a jet of water." },
    { name:"Bubble Beam",   pp:20, power:65,  accuracy:100, type:"water",    desc:"A spray of bubbles that may lower the foe's Speed." },
    { name:"Aqua Tail",     pp:10, power:90,  accuracy:90,  type:"water",    desc:"The user attacks by swinging its tail like a huge wave." },
    { name:"Surf",          pp:15, power:95,  accuracy:100, type:"water",    desc:"A huge wave crashes over the foe. Hits all adjacent foes." },
    { name:"Hydro Pump",    pp:5,  power:120, accuracy:80,  type:"water",    desc:"Blasts water at high pressure. Very powerful but less accurate." },
    { name:"Aqua Jet",      pp:20, power:40,  accuracy:100, type:"water",    desc:"The user lunges at the foe at a speed that defies space, always strikes first." },
    { name:"Waterfall",     pp:15, power:80,  accuracy:100, type:"water",    desc:"The user charges at the foe with great force. May cause flinching." },
    { name:"Origin Pulse",  pp:10, power:110, accuracy:85,  type:"water",    desc:"Legendary water pulses that attack all adjacent foes at once." },
  ],
  electric: [
    { name:"Thunder Shock", pp:30, power:40,  accuracy:100, type:"electric", desc:"A jolt of electricity that may paralyze the foe." },
    { name:"Spark",         pp:20, power:65,  accuracy:100, type:"electric", desc:"A flare of electricity that may paralyze the foe." },
    { name:"Thunderbolt",   pp:15, power:95,  accuracy:100, type:"electric", desc:"A strong electric blast. May leave the foe paralyzed." },
    { name:"Discharge",     pp:15, power:80,  accuracy:100, type:"electric", desc:"A burst of electrical energy that hits all nearby foes." },
    { name:"Thunder",       pp:10, power:120, accuracy:70,  type:"electric", desc:"A massive lightning strike. May cause paralysis." },
    { name:"Volt Tackle",   pp:15, power:120, accuracy:100, type:"electric", desc:"A reckless full-body charge. The user takes some recoil damage." },
    { name:"Thunder Wave",  pp:20, power:0,   accuracy:90,  type:"electric", desc:"A weak electric charge paralyzes the foe, halving its speed." },
    { name:"Bolt Strike",   pp:5,  power:130, accuracy:85,  type:"electric", desc:"An overwhelming lightning strike with possible paralysis." },
  ],
  grass: [
    { name:"Vine Whip",     pp:25, power:45,  accuracy:100, type:"grass",    desc:"The foe is struck with slender, whip-like vines." },
    { name:"Razor Leaf",    pp:25, power:55,  accuracy:95,  type:"grass",    desc:"Sharp leaves are fired in a hail storm. High critical-hit ratio." },
    { name:"Giga Drain",    pp:10, power:75,  accuracy:100, type:"grass",    desc:"A powerful draining move. Restores half the HP inflicted." },
    { name:"Energy Ball",   pp:10, power:90,  accuracy:100, type:"grass",    desc:"A ball of nature's energy. May lower the foe's Sp. Def." },
    { name:"Solar Beam",    pp:10, power:120, accuracy:100, type:"grass",    desc:"Absorbs light one turn, then fires a powerful beam the next." },
    { name:"Leaf Storm",    pp:5,  power:130, accuracy:90,  type:"grass",    desc:"Razor-sharp leaves are hurled. Sharply lowers Sp. Atk after." },
    { name:"Petal Blizzard",pp:15, power:90,  accuracy:100, type:"grass",    desc:"Stirring up a storm of petals, the user attacks." },
    { name:"Frenzy Plant",  pp:5,  power:150, accuracy:90,  type:"grass",    desc:"The ultimate grass move. The user must rest after using it." },
  ],
  ice: [
    { name:"Ice Shard",     pp:30, power:40,  accuracy:100, type:"ice",      desc:"The user shoots a chunk of ice extremely fast. Always strikes first." },
    { name:"Frost Breath",  pp:10, power:60,  accuracy:90,  type:"ice",      desc:"Cold air is exhaled at the foe. Always results in a critical hit." },
    { name:"Ice Beam",      pp:10, power:95,  accuracy:100, type:"ice",      desc:"A freezing beam of ice crystals. May freeze the foe." },
    { name:"Aurora Beam",   pp:20, power:65,  accuracy:100, type:"ice",      desc:"The foe is hit with a rainbow-colored beam. May lower Attack." },
    { name:"Blizzard",      pp:5,  power:120, accuracy:70,  type:"ice",      desc:"A howling blizzard is summoned. May freeze the foe." },
    { name:"Sheer Cold",    pp:5,  power:0,   accuracy:30,  type:"ice",      desc:"An absolute-zero attack that may cause the foe to faint outright." },
    { name:"Freeze-Dry",    pp:20, power:70,  accuracy:100, type:"ice",      desc:"Very effective against Water types. May freeze the foe." },
    { name:"Glaciate",      pp:10, power:65,  accuracy:95,  type:"ice",      desc:"The user attacks by blowing high-powered freezing air at the foe." },
  ],
  fighting: [
    { name:"Karate Chop",   pp:25, power:50,  accuracy:100, type:"fighting", desc:"A sharp chop. High critical-hit ratio." },
    { name:"Low Kick",      pp:20, power:50,  accuracy:100, type:"fighting", desc:"A swift kick that makes the foe fall. Heavier foes take more damage." },
    { name:"Brick Break",   pp:15, power:75,  accuracy:100, type:"fighting", desc:"A hard punch that smashes barriers and inflicts damage." },
    { name:"Drain Punch",   pp:10, power:75,  accuracy:100, type:"fighting", desc:"An energy-draining punch. The user restores half the HP inflicted." },
    { name:"Close Combat",  pp:5,  power:120, accuracy:100, type:"fighting", desc:"The user fights the foe in a close range. Lowers Defense and Sp. Def." },
    { name:"Superpower",    pp:5,  power:120, accuracy:100, type:"fighting", desc:"The user attacks with great power. Lowers Attack and Defense." },
    { name:"Focus Blast",   pp:5,  power:120, accuracy:70,  type:"fighting", desc:"A blast of power from the user. May lower the foe's Sp. Def." },
    { name:"Sky Uppercut",  pp:15, power:85,  accuracy:90,  type:"fighting", desc:"The user attacks with an uppercut that even hits airborne foes." },
  ],
  poison: [
    { name:"Poison Sting",  pp:35, power:15,  accuracy:100, type:"poison",   desc:"The foe is stabbed with a toxic barb. May poison the foe." },
    { name:"Acid",          pp:30, power:40,  accuracy:100, type:"poison",   desc:"The foe is attacked with a spray of harsh acid. May lower Sp. Def." },
    { name:"Venoshock",     pp:10, power:65,  accuracy:100, type:"poison",   desc:"Drenches the foe in a special liquid. Double power if foe is poisoned." },
    { name:"Sludge Bomb",   pp:10, power:90,  accuracy:100, type:"poison",   desc:"Unsanitary sludge is hurled at the foe. May also poison the foe." },
    { name:"Gunk Shot",     pp:5,  power:120, accuracy:80,  type:"poison",   desc:"Filthy garbage is hurled at the foe. May also poison the foe." },
    { name:"Cross Poison",  pp:20, power:70,  accuracy:100, type:"poison",   desc:"A slashing attack that may poison the foe. High critical-hit ratio." },
    { name:"Poison Jab",    pp:20, power:80,  accuracy:100, type:"poison",   desc:"The foe is stabbed with a tentacle. May also poison the foe." },
    { name:"Belch",         pp:10, power:120, accuracy:90,  type:"poison",   desc:"The user lets out a damaging belch. Must have eaten a Berry first." },
  ],
  ground: [
    { name:"Mud Slap",      pp:10, power:20,  accuracy:100, type:"ground",   desc:"Hurls mud in the foe's face to lower its accuracy." },
    { name:"Dig",           pp:10, power:80,  accuracy:100, type:"ground",   desc:"Digs underground the first turn, then attacks the second turn." },
    { name:"Earth Power",   pp:10, power:90,  accuracy:100, type:"ground",   desc:"The user makes the ground erupt with power. May lower Sp. Def." },
    { name:"Earthquake",    pp:10, power:100, accuracy:100, type:"ground",   desc:"Powerful quakes that hit all foes on the ground." },
    { name:"Bulldoze",      pp:20, power:60,  accuracy:100, type:"ground",   desc:"The user stomps down on the ground. Lowers Speed of everyone hit." },
    { name:"Fissure",       pp:5,  power:0,   accuracy:30,  type:"ground",   desc:"An absolute-split attack that may cause the foe to faint outright." },
    { name:"High Horsepower",pp:10,power:95,  accuracy:95,  type:"ground",   desc:"The user attacks the foe with great force." },
    { name:"Precipice Blades",pp:10,power:120,accuracy:85,  type:"ground",   desc:"The user attacks using sharp blades of stone from the ground." },
  ],
  flying: [
    { name:"Gust",          pp:35, power:40,  accuracy:100, type:"flying",   desc:"Strikes the foe with a gust of wind." },
    { name:"Wing Attack",   pp:35, power:60,  accuracy:100, type:"flying",   desc:"The foe is struck with large, clashing wings." },
    { name:"Aerial Ace",    pp:20, power:60,  accuracy:null, type:"flying",  desc:"An extremely fast attack that cannot be evaded." },
    { name:"Air Slash",     pp:15, power:75,  accuracy:95,  type:"flying",   desc:"An attack with a blade of air that may cause flinching." },
    { name:"Brave Bird",    pp:15, power:120, accuracy:100, type:"flying",   desc:"A reckless, full-power rush that also hurts the user." },
    { name:"Sky Attack",    pp:5,  power:140, accuracy:90,  type:"flying",   desc:"A powerful sky attack that may cause flinching." },
    { name:"Hurricane",     pp:10, power:110, accuracy:70,  type:"flying",   desc:"Powerful winds that may confuse the foe." },
    { name:"Oblivion Wing", pp:10, power:80,  accuracy:100, type:"flying",   desc:"The user absorbs the foe's energy, restoring HP equal to ¾ dealt." },
  ],
  psychic: [
    { name:"Confusion",     pp:25, power:50,  accuracy:100, type:"psychic",  desc:"A telepathic attack that may cause confusion." },
    { name:"Psybeam",       pp:20, power:65,  accuracy:100, type:"psychic",  desc:"The foe is attacked with a peculiar ray. May cause confusion." },
    { name:"Psychic",       pp:10, power:90,  accuracy:100, type:"psychic",  desc:"The foe is hit by a strong telekinetic force. May lower Sp. Def." },
    { name:"Psystrike",     pp:10, power:100, accuracy:100, type:"psychic",  desc:"Creates a peculiar pulse that attacks the foe's physical side." },
    { name:"Future Sight",  pp:10, power:120, accuracy:100, type:"psychic",  desc:"Two turns after this move, the foe takes psychic damage." },
    { name:"Zen Headbutt",  pp:15, power:80,  accuracy:90,  type:"psychic",  desc:"The user focuses its willpower and rams the foe. May cause flinching." },
    { name:"Psycho Boost",  pp:5,  power:140, accuracy:90,  type:"psychic",  desc:"An overwhelming psychic blast. Sharply lowers Sp. Atk after." },
    { name:"Dream Eater",   pp:15, power:100, accuracy:100, type:"psychic",  desc:"Eats the dreams of a sleeping foe. Restores HP equal to ½ damage." },
  ],
  bug: [
    { name:"Bug Bite",      pp:20, power:60,  accuracy:100, type:"bug",      desc:"The user bites the foe. If the foe holds a Berry, the user eats it." },
    { name:"Leech Life",    pp:10, power:80,  accuracy:100, type:"bug",      desc:"The user drains the foe's blood. The user's HP is restored by half the damage dealt." },
    { name:"Signal Beam",   pp:15, power:75,  accuracy:100, type:"bug",      desc:"The user attacks with a sinister beam. May cause confusion." },
    { name:"X-Scissor",     pp:15, power:80,  accuracy:100, type:"bug",      desc:"The user slashes at the foe by crossing its scythes or claws." },
    { name:"Bug Buzz",      pp:10, power:90,  accuracy:100, type:"bug",      desc:"The user generates a damaging sound wave. May lower Sp. Def." },
    { name:"Megahorn",      pp:10, power:120, accuracy:85,  type:"bug",      desc:"A brutal headbutt using a long, hard horn. Very powerful." },
    { name:"First Impression",pp:10,power:90, accuracy:100, type:"bug",      desc:"Very high priority. Only works on the first turn after switching in." },
    { name:"Lunge",         pp:15, power:80,  accuracy:100, type:"bug",      desc:"The user makes a lunge at the foe, lowering the foe's Attack stat." },
  ],
  rock: [
    { name:"Rock Throw",    pp:15, power:50,  accuracy:90,  type:"rock",     desc:"The user picks up and throws a small boulder at the foe." },
    { name:"Rock Slide",    pp:10, power:75,  accuracy:90,  type:"rock",     desc:"Large boulders are hurled. May cause the foe to flinch." },
    { name:"Power Gem",     pp:20, power:80,  accuracy:100, type:"rock",     desc:"The user attacks with a ray of light that sparkles as if it were made of gemstones." },
    { name:"Stone Edge",    pp:5,  power:100, accuracy:80,  type:"rock",     desc:"Stabs the foe with a sharp stone. High critical-hit ratio." },
    { name:"Rock Wrecker",  pp:5,  power:150, accuracy:90,  type:"rock",     desc:"The user launches a huge boulder at the foe. Must rest after." },
    { name:"Head Smash",    pp:5,  power:150, accuracy:80,  type:"rock",     desc:"A reckless, life-risking tackle. The user also takes heavy recoil." },
    { name:"Smack Down",    pp:15, power:50,  accuracy:100, type:"rock",     desc:"Throws a stone to knock the foe down to the ground." },
    { name:"Ancient Power", pp:5,  power:60,  accuracy:100, type:"rock",     desc:"An attack using primitive power. May raise all the user's stats." },
  ],
  ghost: [
    { name:"Shadow Sneak",  pp:30, power:40,  accuracy:100, type:"ghost",    desc:"The user extends its shadow and attacks at increased priority." },
    { name:"Hex",           pp:10, power:65,  accuracy:100, type:"ghost",    desc:"This move inflicts double damage on a foe with a status problem." },
    { name:"Night Shade",   pp:15, power:0,   accuracy:100, type:"ghost",    desc:"The user makes the foe see a frightening mirage. Deals damage equal to the user's level." },
    { name:"Shadow Ball",   pp:15, power:80,  accuracy:100, type:"ghost",    desc:"A sinister shadow ball is hurled. May lower the foe's Sp. Def." },
    { name:"Shadow Force",  pp:5,  power:120, accuracy:null, type:"ghost",   desc:"Vanishes the first turn, then strikes the second. Bypasses Protect." },
    { name:"Spectral Thief",pp:10, power:90,  accuracy:100, type:"ghost",    desc:"The user lurks in the foe's shadow and steals the foe's stat boosts." },
    { name:"Phantom Force", pp:10, power:90,  accuracy:null, type:"ghost",   desc:"Disappears first turn, strikes second. Bypasses Protect and Detect." },
    { name:"Never-Ending Nightmare",pp:5,power:140,accuracy:100,type:"ghost",desc:"Deep, abyssal darkness envelops the foe." },
  ],
  dragon: [
    { name:"Dragon Breath", pp:20, power:60,  accuracy:100, type:"dragon",   desc:"Exhales a damaging breath. May paralyze the foe." },
    { name:"Dragon Claw",   pp:15, power:80,  accuracy:100, type:"dragon",   desc:"The user slashes at the foe with sharp claws." },
    { name:"Dragon Pulse",  pp:10, power:85,  accuracy:null, type:"dragon",  desc:"A powerful pulse of draconic energy. Never misses." },
    { name:"Outrage",       pp:10, power:120, accuracy:100, type:"dragon",   desc:"A rampage of 2–3 turns. The user gets confused afterward." },
    { name:"Dragon Rush",   pp:10, power:100, accuracy:75,  type:"dragon",   desc:"The user tackles the foe while exhibiting overwhelming menace." },
    { name:"Draco Meteor",  pp:5,  power:130, accuracy:90,  type:"dragon",   desc:"Comets are summoned from the sky. Sharply lowers Sp. Atk after." },
    { name:"Spacial Rend",  pp:5,  power:100, accuracy:95,  type:"dragon",   desc:"Tears the foe apart with special power. High critical-hit ratio." },
    { name:"Roar of Time",  pp:5,  power:150, accuracy:90,  type:"dragon",   desc:"The ultimate dragon move. The user must rest after." },
  ],
  dark: [
    { name:"Bite",          pp:25, power:60,  accuracy:100, type:"dark",     desc:"The foe is bitten with viciously sharp fangs. May cause flinching." },
    { name:"Feint Attack",  pp:20, power:60,  accuracy:null, type:"dark",    desc:"The user approaches the foe with a feint. Never misses." },
    { name:"Dark Pulse",    pp:15, power:80,  accuracy:100, type:"dark",     desc:"Releases a horrible aura imbued with dark thoughts. May cause flinching." },
    { name:"Crunch",        pp:15, power:80,  accuracy:100, type:"dark",     desc:"The user crunches up the foe with sharp fangs. May lower Defense." },
    { name:"Night Daze",    pp:10, power:85,  accuracy:95,  type:"dark",     desc:"The user lets loose a pitch-black shock wave. May lower Accuracy." },
    { name:"Foul Play",     pp:15, power:95,  accuracy:100, type:"dark",     desc:"Turns the foe's strength against it. Uses foe's Attack stat." },
    { name:"Payback",       pp:10, power:50,  accuracy:100, type:"dark",     desc:"If the user moves after the foe, this attack's power is doubled." },
    { name:"Hyperspace Fury",pp:5, power:100, accuracy:null, type:"dark",    desc:"Unleashes a barrage of attacks. Lowers user's Defense." },
  ],
  steel: [
    { name:"Metal Claw",    pp:35, power:50,  accuracy:95,  type:"steel",    desc:"The foe is raked with steel claws. May raise the user's Attack." },
    { name:"Iron Head",     pp:15, power:80,  accuracy:100, type:"steel",    desc:"The user rams the foe with its steel-hard head. May cause flinching." },
    { name:"Flash Cannon",  pp:10, power:80,  accuracy:100, type:"steel",    desc:"Gathers all light and releases it at once. May lower Sp. Def." },
    { name:"Iron Tail",     pp:15, power:100, accuracy:75,  type:"steel",    desc:"A steel-hard tail is slammed against the foe. May lower Defense." },
    { name:"Steel Beam",    pp:5,  power:140, accuracy:95,  type:"steel",    desc:"The user fires a beam of steel. The user loses half their HP." },
    { name:"Meteor Mash",   pp:10, power:90,  accuracy:90,  type:"steel",    desc:"A ramming attack similar to a comet. May raise Attack." },
    { name:"Gyro Ball",     pp:5,  power:0,   accuracy:100, type:"steel",    desc:"A gyrating tackle that does more damage the slower the user is." },
    { name:"Doom Desire",   pp:5,  power:140, accuracy:100, type:"steel",    desc:"Two turns later, a concentrated bundle of light blasts the foe." },
  ],
  fairy: [
    { name:"Fairy Wind",    pp:30, power:40,  accuracy:100, type:"fairy",    desc:"The user stirs up a fairy wind and attacks the foe with it." },
    { name:"Disarming Voice",pp:15,power:40,  accuracy:null, type:"fairy",   desc:"Lets out a charming cry that never misses." },
    { name:"Dazzling Gleam",pp:10, power:80,  accuracy:100, type:"fairy",    desc:"A powerful flash of light that hits all foes at once." },
    { name:"Play Rough",    pp:10, power:90,  accuracy:90,  type:"fairy",    desc:"Plays rough with the foe. May lower Attack." },
    { name:"Moonblast",     pp:15, power:95,  accuracy:100, type:"fairy",    desc:"Borrowing the power of the moon, the user attacks. May lower Sp. Atk." },
    { name:"Light of Ruin", pp:5,  power:140, accuracy:75,  type:"fairy",    desc:"Drawing power from the Eternal Flower, the user fires an energy beam." },
    { name:"Sparkling Aria",pp:10, power:90,  accuracy:100, type:"fairy",    desc:"The user bursts into song, showering the foe with notes." },
    { name:"Misty Explosion",pp:5, power:100, accuracy:100, type:"fairy",    desc:"The user explodes with all the power of Misty Terrain." },
  ],
  normal: [
    { name:"Tackle",        pp:35, power:40,  accuracy:100, type:"normal",   desc:"A physical attack that charges the foe with full-body contact." },
    { name:"Quick Attack",  pp:30, power:40,  accuracy:100, type:"normal",   desc:"A lightning-fast move that always strikes first." },
    { name:"Body Slam",     pp:15, power:85,  accuracy:100, type:"normal",   desc:"A full-body tackle. May paralyze the foe." },
    { name:"Hyper Voice",   pp:10, power:90,  accuracy:100, type:"normal",   desc:"A loud, forceful attack using powerful sound waves." },
    { name:"Hyper Beam",    pp:5,  power:150, accuracy:90,  type:"normal",   desc:"The most powerful normal attack. The user must rest after." },
    { name:"Facade",        pp:20, power:70,  accuracy:100, type:"normal",   desc:"A powerful attack that does double damage when user has a status problem." },
    { name:"Extreme Speed", pp:5,  power:80,  accuracy:100, type:"normal",   desc:"An extremely fast and powerful attack. Always goes first." },
    { name:"Boomburst",     pp:10, power:140, accuracy:100, type:"normal",   desc:"The user attacks everything with an explosive sound wave." },
  ],
};

/**
 * Returns starting moves for a Pokémon, scaled to its level.
 *
 * Move count by level:
 *   Lv 1–9  → 2 moves  (weakest only)
 *   Lv 10–14 → 3 moves
 *   Lv 15–24 → 4 moves
 *   Lv 25–39 → 5 moves
 *   Lv 40+   → 6 moves  (full starter set)
 *
 * Type split:
 *   Single-type  → all slots from that type's pool, weakest moves first.
 *   Dual-type    → ~2/3 primary type, ~1/3 secondary type, GROUPED (primary
 *                  moves first, secondary appended — never interleaved).
 *                  At low levels only the primary type is represented.
 */
export function getMovesForType(primaryType, allTypes = [], level = 5) {
  const types = Array.isArray(allTypes) && allTypes.length > 0 ? allTypes : [primaryType];
  const uniqueTypes = [...new Set(types.filter(Boolean))];

  // How many moves this Pokémon knows at this level
  const totalMoves = level >= 40 ? 6
                   : level >= 25 ? 5
                   : level >= 15 ? 4
                   : level >= 10 ? 3
                   : 2;

  if (uniqueTypes.length === 1) {
    // Single type — take the first N moves (ordered weakest → strongest)
    const pool = TYPE_MOVES[uniqueTypes[0]] || TYPE_MOVES.normal;
    return pool.slice(0, totalMoves);
  }

  // Dual (or more) types:
  //   Primary   → ceil(2/3) of slots  (always comes first, no interleaving)
  //   Secondary → remaining slots     (0 at very low levels)
  const primaryPool   = TYPE_MOVES[uniqueTypes[0]] || TYPE_MOVES.normal;
  const secondaryPool = TYPE_MOVES[uniqueTypes[1]] || TYPE_MOVES.normal;

  const primaryCount   = Math.ceil(totalMoves * 2 / 3);
  const secondaryCount = totalMoves - primaryCount;

  return [
    ...primaryPool.slice(0, primaryCount),
    ...(secondaryCount > 0 ? secondaryPool.slice(0, secondaryCount) : []),
  ];
}

/**
 * Returns a new learnable move at certain level milestones.
 * For dual-type Pokémon the candidate pool includes moves from ALL their types,
 * so a Dragon/Water Pokémon can learn both Dragon and Water moves on level up.
 * Returns null if no new move is available.
 */
export function getLearnableMoveAtLevel(primaryType, level, currentMoves = [], allTypes = []) {
  const milestones = [10, 15, 20, 25, 30, 35, 40, 50, 60, 75, 100];
  if (!milestones.includes(level)) return null;

  // Build a candidate pool from all types the Pokémon has
  const types = Array.isArray(allTypes) && allTypes.length > 0
    ? [...new Set(allTypes.filter(Boolean))]
    : [primaryType];

  const currentNames = new Set(currentMoves.map((m) => m.name));
  const candidateMap = new Map(); // name → move (deduplicate)
  for (const type of types) {
    const pool = TYPE_MOVES[type] || [];
    for (const m of pool) {
      if (!currentNames.has(m.name) && !candidateMap.has(m.name)) {
        candidateMap.set(m.name, m);
      }
    }
  }

  const candidates = [...candidateMap.values()];
  if (candidates.length === 0) return null;

  // Pick based on level: higher levels give stronger moves
  const sorted = [...candidates].sort((a, b) => (b.power || 0) - (a.power || 0));
  const idx = level >= 40 ? 0 : level >= 20 ? Math.floor(sorted.length / 2) : sorted.length - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Type emoji map ────────────────────────────────────────────────────────────
export const TYPE_EMOJIS = {
  fire:"🔥", water:"💧", grass:"🍃", electric:"⚡", psychic:"🔮",
  normal:"⭐", flying:"🌤️", bug:"🐛", poison:"☠️", rock:"🪨", ground:"🌍",
  ice:"❄️", fighting:"🥊", ghost:"👻", dragon:"🐉", dark:"🌑", steel:"⚙️", fairy:"🌸",
};

// ── Type effectiveness chart (attack type → defender type → multiplier) ───────
const TYPE_CHART = {
  normal:   { rock:0.5, ghost:0, steel:0.5 },
  fire:     { fire:0.5, water:0.5, rock:0.5, dragon:0.5, grass:2, ice:2, bug:2, steel:2 },
  water:    { water:0.5, grass:0.5, dragon:0.5, fire:2, ground:2, rock:2 },
  electric: { electric:0.5, grass:0.5, dragon:0.5, ground:0, flying:2, water:2 },
  grass:    { fire:0.5, grass:0.5, poison:0.5, flying:0.5, bug:0.5, dragon:0.5, steel:0.5, water:2, ground:2, rock:2 },
  ice:      { water:0.5, ice:0.5, steel:0.5, fire:0.5, grass:2, ground:2, flying:2, dragon:2 },
  fighting: { poison:0.5, flying:0.5, psychic:0.5, bug:0.5, fairy:0.5, ghost:0, normal:2, ice:2, rock:2, dark:2, steel:2 },
  poison:   { poison:0.5, ground:0.5, rock:0.5, ghost:0.5, steel:0, grass:2, fairy:2 },
  ground:   { grass:0.5, bug:0.5, flying:0, electric:2, fire:2, poison:2, rock:2, steel:2 },
  flying:   { electric:0.5, rock:0.5, steel:0.5, ground:0, grass:2, fighting:2, bug:2 },
  psychic:  { psychic:0.5, steel:0.5, dark:0, fighting:2, poison:2 },
  bug:      { fire:0.5, fighting:0.5, flying:0.5, ghost:0.5, steel:0.5, fairy:0.5, grass:2, psychic:2, dark:2 },
  rock:     { fighting:0.5, ground:0.5, steel:0.5, normal:2, fire:2, flying:2, ice:2, bug:2 },
  ghost:    { normal:0, dark:0.5, psychic:2, ghost:2 },
  dragon:   { steel:0.5, fairy:0, dragon:2 },
  dark:     { fighting:0.5, dark:0.5, fairy:0.5, psychic:2, ghost:2 },
  steel:    { fire:0.5, water:0.5, electric:0.5, steel:0.5, ice:2, rock:2, fairy:2 },
  fairy:    { fire:0.5, poison:0.5, steel:0.5, fighting:2, dragon:2, dark:2 },
};

/**
 * Returns the type effectiveness multiplier for a move hitting a defender
 * with one or more types (e.g. ["fire","fighting"] for Blaziken).
 */
export function getTypeEffectiveness(moveType, defenderTypes = []) {
  let mult = 1;
  const chart = TYPE_CHART[moveType] || {};
  for (const dt of defenderTypes) {
    mult *= (chart[dt] ?? 1);
  }
  return mult;
}

/**
 * Returns the human-readable effectiveness string, or null for normal damage.
 */
export function effectivenessText(mult) {
  if (mult === 0)    return "It has no effect...";
  if (mult >= 2)     return "It's super effective!";
  if (mult <= 0.5)   return "It's not effective...";
  return null; // normal effectiveness — don't show a line
}

// ── Damage formula (simplified Gen 3 style) ──────────────────────────────────
export function wildLevel(trainerLevel = 1) {
  const base = Math.max(1, trainerLevel);
  const min = Math.max(1, base - 3);
  const max = base + 3;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Standard wild encounters stay in a friendly level 5–10 range.
export function randomWildLevel(min = 5, max = 10) {
  const low = Math.max(1, Math.floor(Number(min) || 5));
  const high = Math.max(low, Math.floor(Number(max) || 10));
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

export function calcDamage(attacker, defender, move) {
  if (!move.power || move.power === 0) return 0;
  const level = attacker.level || 5;
  const atk = attacker.attack || 10;
  const def = defender.defense || 10;
  const power = move.power;
  const base = ((2 * level / 5 + 2) * power * atk / def) / 50 + 2;
  const roll = 0.85 + Math.random() * 0.15;
  const stab = (attacker.types || []).includes(move.type) ? 1.5 : 1;
  return Math.max(1, Math.floor(base * roll * stab));
}

// ── Catch rates ───────────────────────────────────────────────────────────────
export const POKEBALL_CATCH_RATES = {
  pokeball:    0.30,
  greatball:   0.45,
  ultraball:   0.60,
  masterball:  0.80,
  quickball:   0.50,
  duskball:    0.40,
  nestball:    0.35,
  healball:    0.30,
  timerball:   0.45,
  luxuryball:  0.30,
  beastball:   1.00, // 100% catch rate — guaranteed capture
  premierball: 0.35,
  netball:     0.45,
};

export function tryCatch(ballType, wildPokemon) {
  // Beast Ball: guaranteed 100% catch, no luck needed
  if (ballType === "beastball") return { success: true, roll: 0, catchRate: 1.0 };
  const rate = POKEBALL_CATCH_RATES[ballType] || 0.30;
  const hpFactor = wildPokemon.hp / wildPokemon.maxHp;
  const catchRate = rate * (1 - hpFactor * 0.5);
  const roll = Math.random();
  return { success: roll < catchRate, roll, catchRate };
}

// ── XP reward from battle ─────────────────────────────────────────────────────
export function xpReward(opponentPokemon) {
  // Slightly improved XP so fainted wild Pokémon feel more rewarding.
  const level = Math.max(1, Math.floor(Number(opponentPokemon?.level) || 1));
  return Math.floor(level * 135 + Math.random() * 90 + 75);
}

/**
 * PvP XP reward based on the Pokémon that was defeated.
 * The quadratic level component makes high-level victories rewarding without
 * making low-level PvP battles hand out endgame-sized rewards.
 */
export function pvpXpReward(winnerPokemon, defeatedPokemon) {
  const defeatedLevel = Math.max(1, Math.min(100, Math.floor(Number(defeatedPokemon?.level) || 1)));
  const winnerLevel = Math.max(1, Math.min(100, Math.floor(Number(winnerPokemon?.level) || 1)));
  const baseReward = 250 + (defeatedLevel * 100) + (defeatedLevel * defeatedLevel * 7);
  const higherLevelBonus = Math.max(0, defeatedLevel - winnerLevel) * 250;
  const variance = Math.floor(Math.random() * Math.max(50, baseReward * 0.12));
  return Math.floor(baseReward + higherLevelBonus + variance);
}

// ── Coin reward from battle ───────────────────────────────────────────────────
export function coinReward(opponentLevel) {
  return Math.floor(opponentLevel * 40 + Math.random() * 60 + 20);
}

// ── Level evolution map ──────────────────────────────────────────────────────
export const LEVEL_EVOLUTIONS = {
  // Gen 1 Starters
  bulbasaur:   { level: 16, evolvesTo: "ivysaur"      },
  ivysaur:     { level: 32, evolvesTo: "venusaur"     },
  charmander:  { level: 16, evolvesTo: "charmeleon"   },
  charmeleon:  { level: 36, evolvesTo: "charizard"    },
  squirtle:    { level: 16, evolvesTo: "wartortle"    },
  wartortle:   { level: 36, evolvesTo: "blastoise"    },
  // Gen 1 Common
  caterpie:    { level: 7,  evolvesTo: "metapod"      },
  metapod:     { level: 10, evolvesTo: "butterfree"   },
  weedle:      { level: 7,  evolvesTo: "kakuna"       },
  kakuna:      { level: 10, evolvesTo: "beedrill"     },
  pidgey:      { level: 18, evolvesTo: "pidgeotto"    },
  pidgeotto:   { level: 36, evolvesTo: "pidgeot"      },
  rattata:     { level: 20, evolvesTo: "raticate"     },
  spearow:     { level: 20, evolvesTo: "fearow"       },
  ekans:       { level: 22, evolvesTo: "arbok"        },
  sandshrew:   { level: 22, evolvesTo: "sandslash"    },
  zubat:       { level: 22, evolvesTo: "golbat"       },
  golbat:      { level: 40, evolvesTo: "crobat"       },
  oddish:      { level: 21, evolvesTo: "gloom"        },
  paras:       { level: 24, evolvesTo: "parasect"     },
  venonat:     { level: 31, evolvesTo: "venomoth"     },
  diglett:     { level: 26, evolvesTo: "dugtrio"      },
  meowth:      { level: 28, evolvesTo: "persian"      },
  psyduck:     { level: 33, evolvesTo: "golduck"      },
  mankey:      { level: 28, evolvesTo: "primeape"     },
  growlithe:   { level: 36, evolvesTo: "arcanine"     },
  poliwag:     { level: 25, evolvesTo: "poliwhirl"    },
  poliwhirl:   { level: 40, evolvesTo: "poliwrath"    },
  abra:        { level: 16, evolvesTo: "kadabra"      },
  kadabra:     { level: 36, evolvesTo: "alakazam"     },
  machop:      { level: 28, evolvesTo: "machoke"      },
  machoke:     { level: 36, evolvesTo: "machamp"      },
  bellsprout:  { level: 21, evolvesTo: "weepinbell"   },
  tentacool:   { level: 30, evolvesTo: "tentacruel"   },
  geodude:     { level: 25, evolvesTo: "graveler"     },
  graveler:    { level: 36, evolvesTo: "golem"        },
  ponyta:      { level: 40, evolvesTo: "rapidash"     },
  slowpoke:    { level: 37, evolvesTo: "slowbro"      },
  magnemite:   { level: 30, evolvesTo: "magneton"     },
  doduo:       { level: 31, evolvesTo: "dodrio"       },
  seel:        { level: 34, evolvesTo: "dewgong"      },
  grimer:      { level: 38, evolvesTo: "muk"          },
  gastly:      { level: 25, evolvesTo: "haunter"      },
  haunter:     { level: 36, evolvesTo: "gengar"       },
  drowzee:     { level: 26, evolvesTo: "hypno"        },
  krabby:      { level: 28, evolvesTo: "kingler"      },
  voltorb:     { level: 30, evolvesTo: "electrode"    },
  cubone:      { level: 28, evolvesTo: "marowak"      },
  koffing:     { level: 35, evolvesTo: "weezing"      },
  rhyhorn:     { level: 42, evolvesTo: "rhydon"       },
  horsea:      { level: 32, evolvesTo: "seadra"       },
  goldeen:     { level: 33, evolvesTo: "seaking"      },
  magikarp:    { level: 20, evolvesTo: "gyarados"     },
  dratini:     { level: 30, evolvesTo: "dragonair"    },
  dragonair:   { level: 55, evolvesTo: "dragonite"    },
  // Gen 2 Starters
  chikorita:   { level: 16, evolvesTo: "bayleef"      },
  bayleef:     { level: 32, evolvesTo: "meganium"     },
  cyndaquil:   { level: 14, evolvesTo: "quilava"      },
  quilava:     { level: 36, evolvesTo: "typhlosion"   },
  totodile:    { level: 18, evolvesTo: "croconaw"     },
  croconaw:    { level: 30, evolvesTo: "feraligatr"   },
  // Gen 2 Common
  sentret:     { level: 15, evolvesTo: "furret"       },
  hoothoot:    { level: 20, evolvesTo: "noctowl"      },
  ledyba:      { level: 18, evolvesTo: "ledian"       },
  spinarak:    { level: 22, evolvesTo: "ariados"      },
  chinchou:    { level: 27, evolvesTo: "lanturn"      },
  pichu:       { level: 20, evolvesTo: "pikachu"      },
  cleffa:      { level: 18, evolvesTo: "clefairy"     },
  igglybuff:   { level: 15, evolvesTo: "jigglypuff"   },
  togepi:      { level: 20, evolvesTo: "togetic"      },
  togetic:     { level: 35, evolvesTo: "togekiss"     },
  natu:        { level: 25, evolvesTo: "xatu"         },
  mareep:      { level: 15, evolvesTo: "flaaffy"      },
  flaaffy:     { level: 30, evolvesTo: "ampharos"     },
  hoppip:      { level: 18, evolvesTo: "skiploom"     },
  skiploom:    { level: 27, evolvesTo: "jumpluff"     },
  wooper:      { level: 20, evolvesTo: "quagsire"     },
  slugma:      { level: 38, evolvesTo: "magcargo"     },
  swinub:      { level: 33, evolvesTo: "piloswine"    },
  remoraid:    { level: 25, evolvesTo: "octillery"    },
  houndour:    { level: 24, evolvesTo: "houndoom"     },
  phanpy:      { level: 25, evolvesTo: "donphan"      },
  // Gen 3 Starters
  treecko:     { level: 16, evolvesTo: "grovyle"      },
  grovyle:     { level: 36, evolvesTo: "sceptile"     },
  torchic:     { level: 16, evolvesTo: "combusken"    },
  combusken:   { level: 36, evolvesTo: "blaziken"     },
  mudkip:      { level: 16, evolvesTo: "marshtomp"    },
  marshtomp:   { level: 36, evolvesTo: "swampert"     },
  // Gen 3 Common
  poochyena:   { level: 18, evolvesTo: "mightyena"    },
  zigzagoon:   { level: 20, evolvesTo: "linoone"      },
  wurmple:     { level: 7,  evolvesTo: "silcoon"      },
  silcoon:     { level: 10, evolvesTo: "beautifly"    },
  ralts:       { level: 20, evolvesTo: "kirlia"       },
  kirlia:      { level: 30, evolvesTo: "gardevoir"    },
  shroomish:   { level: 23, evolvesTo: "breloom"      },
  slakoth:     { level: 18, evolvesTo: "vigoroth"     },
  vigoroth:    { level: 36, evolvesTo: "slaking"      },
  whismur:     { level: 20, evolvesTo: "loudred"      },
  loudred:     { level: 40, evolvesTo: "exploud"      },
  makuhita:    { level: 24, evolvesTo: "hariyama"     },
  aron:        { level: 32, evolvesTo: "lairon"       },
  lairon:      { level: 42, evolvesTo: "aggron"       },
  electrike:   { level: 26, evolvesTo: "manectric"    },
  carvanha:    { level: 30, evolvesTo: "sharpedo"     },
  wailmer:     { level: 40, evolvesTo: "wailord"      },
  numel:       { level: 33, evolvesTo: "camerupt"     },
  trapinch:    { level: 35, evolvesTo: "vibrava"      },
  vibrava:     { level: 45, evolvesTo: "flygon"       },
  cacnea:      { level: 32, evolvesTo: "cacturne"     },
  swablu:      { level: 35, evolvesTo: "altaria"      },
  barboach:    { level: 30, evolvesTo: "whiscash"     },
  shuppet:     { level: 37, evolvesTo: "banette"      },
  duskull:     { level: 37, evolvesTo: "dusclops"     },
  bagon:       { level: 30, evolvesTo: "shelgon"      },
  shelgon:     { level: 50, evolvesTo: "salamence"    },
  beldum:      { level: 20, evolvesTo: "metang"       },
  metang:      { level: 45, evolvesTo: "metagross"    },
  // Gen 4 Starters
  turtwig:     { level: 18, evolvesTo: "grotle"       },
  grotle:      { level: 32, evolvesTo: "torterra"     },
  chimchar:    { level: 14, evolvesTo: "monferno"     },
  monferno:    { level: 36, evolvesTo: "infernape"    },
  piplup:      { level: 16, evolvesTo: "prinplup"     },
  prinplup:    { level: 36, evolvesTo: "empoleon"     },
  // Gen 4 Common
  starly:      { level: 14, evolvesTo: "staravia"     },
  staravia:    { level: 34, evolvesTo: "staraptor"    },
  shinx:       { level: 15, evolvesTo: "luxio"        },
  luxio:       { level: 30, evolvesTo: "luxray"       },
  gible:       { level: 24, evolvesTo: "gabite"       },
  gabite:      { level: 48, evolvesTo: "garchomp"     },
  munchlax:    { level: 20, evolvesTo: "snorlax"      },
  riolu:       { level: 25, evolvesTo: "lucario"      },
  hippopotas:  { level: 34, evolvesTo: "hippowdon"    },
  croagunk:    { level: 37, evolvesTo: "toxicroak"    },
  deino:       { level: 50, evolvesTo: "zweilous"     },
  zweilous:    { level: 64, evolvesTo: "hydreigon"    },
  // Gen 5 Starters
  snivy:       { level: 17, evolvesTo: "servine"      },
  servine:     { level: 36, evolvesTo: "serperior"    },
  tepig:       { level: 17, evolvesTo: "pignite"      },
  pignite:     { level: 36, evolvesTo: "emboar"       },
  oshawott:    { level: 17, evolvesTo: "dewott"       },
  dewott:      { level: 36, evolvesTo: "samurott"     },
  // Gen 5 Common
  patrat:      { level: 20, evolvesTo: "watchog"      },
  lillipup:    { level: 16, evolvesTo: "herdier"      },
  herdier:     { level: 32, evolvesTo: "stoutland"    },
  purrloin:    { level: 20, evolvesTo: "liepard"      },
  pidove:      { level: 21, evolvesTo: "tranquill"    },
  tranquill:   { level: 32, evolvesTo: "unfezant"     },
  blitzle:     { level: 27, evolvesTo: "zebstrika"    },
  tympole:     { level: 25, evolvesTo: "palpitoad"    },
  palpitoad:   { level: 36, evolvesTo: "seismitoad"   },
  sandile:     { level: 29, evolvesTo: "krokorok"     },
  krokorok:    { level: 40, evolvesTo: "krookodile"   },
  zorua:       { level: 30, evolvesTo: "zoroark"      },
  axew:        { level: 38, evolvesTo: "fraxure"      },
  fraxure:     { level: 48, evolvesTo: "haxorus"      },
  deino:       { level: 50, evolvesTo: "zweilous"     },
  zweilous:    { level: 64, evolvesTo: "hydreigon"    },
  // Gen 6 Starters
  chespin:     { level: 16, evolvesTo: "quilladin"    },
  quilladin:   { level: 36, evolvesTo: "chesnaught"   },
  fennekin:    { level: 16, evolvesTo: "braixen"      },
  braixen:     { level: 36, evolvesTo: "delphox"      },
  froakie:     { level: 16, evolvesTo: "frogadier"    },
  frogadier:   { level: 36, evolvesTo: "greninja"     },
  // Gen 6 Common
  bunnelby:    { level: 20, evolvesTo: "diggersby"    },
  fletchling:  { level: 17, evolvesTo: "fletchinder"  },
  fletchinder: { level: 35, evolvesTo: "talonflame"   },
  espurr:      { level: 25, evolvesTo: "meowstic"     },
  honedge:     { level: 35, evolvesTo: "doublade"     },
  doublade:    { level: 45, evolvesTo: "aegislash"    },
  goomy:       { level: 40, evolvesTo: "sliggoo"      },
  sliggoo:     { level: 50, evolvesTo: "goodra"       },
  noibat:      { level: 48, evolvesTo: "noivern"      },
  // Gen 7 Starters
  rowlet:      { level: 17, evolvesTo: "dartrix"      },
  dartrix:     { level: 34, evolvesTo: "decidueye"    },
  litten:      { level: 17, evolvesTo: "torracat"     },
  torracat:    { level: 34, evolvesTo: "incineroar"   },
  popplio:     { level: 17, evolvesTo: "brionne"      },
  brionne:     { level: 34, evolvesTo: "primarina"    },
  // Gen 7 Common
  pikipek:     { level: 14, evolvesTo: "trumbeak"     },
  trumbeak:    { level: 28, evolvesTo: "toucannon"    },
  yungoos:     { level: 20, evolvesTo: "gumshoos"     },
  rockruff:    { level: 25, evolvesTo: "lycanroc"     },
  mareanie:    { level: 38, evolvesTo: "toxapex"      },
  mudbray:     { level: 30, evolvesTo: "mudsdale"     },
  stufful:     { level: 27, evolvesTo: "bewear"       },
  jangmo_o:    { level: 35, evolvesTo: "hakamo-o"     },
  "jangmo-o":  { level: 35, evolvesTo: "hakamo-o"     },
  "hakamo-o":  { level: 45, evolvesTo: "kommo-o"      },
  // Gen 7 (Alola) — additional lines missing from original
  grubbin:     { level: 20, evolvesTo: "charjabug"    },
  charjabug:   { level: 30, evolvesTo: "vikavolt"     },
  fomantis:    { level: 34, evolvesTo: "lurantis"     },
  morelull:    { level: 24, evolvesTo: "shiinotic"    },
  bounsweet:   { level: 18, evolvesTo: "steenee"      },
  steenee:     { level: 28, evolvesTo: "tsareena"     },
  wimpod:      { level: 30, evolvesTo: "golisopod"    },
  sandygast:   { level: 42, evolvesTo: "palossand"    },
  cosmog:      { level: 43, evolvesTo: "cosmoem"      },
  cosmoem:     { level: 53, evolvesTo: "solgaleo"     },
  komala:      { level: 30, evolvesTo: "komala"       }, // no evo, kept for completeness
  // Gen 8 (Galar) ─────────────────────────────────────────────────────────────
  grookey:     { level: 16, evolvesTo: "thwackey"     },
  thwackey:    { level: 35, evolvesTo: "rillaboom"    },
  scorbunny:   { level: 16, evolvesTo: "raboot"       },
  raboot:      { level: 35, evolvesTo: "cinderace"    },
  sobble:      { level: 16, evolvesTo: "drizzile"     },
  drizzile:    { level: 35, evolvesTo: "inteleon"     },
  skwovet:     { level: 24, evolvesTo: "greedent"     },
  rookidee:    { level: 18, evolvesTo: "corvisquire"  },
  corvisquire: { level: 38, evolvesTo: "corviknight"  },
  blipbug:     { level: 10, evolvesTo: "dottler"      },
  dottler:     { level: 30, evolvesTo: "orbeetle"     },
  nickit:      { level: 18, evolvesTo: "thievul"      },
  gossifleur:  { level: 20, evolvesTo: "eldegoss"     },
  wooloo:      { level: 24, evolvesTo: "dubwool"      },
  chewtle:     { level: 22, evolvesTo: "drednaw"      },
  yamper:      { level: 25, evolvesTo: "boltund"      },
  rolycoly:    { level: 18, evolvesTo: "carkol"       },
  carkol:      { level: 34, evolvesTo: "coalossal"    },
  silicobra:   { level: 36, evolvesTo: "sandaconda"   },
  toxel:       { level: 30, evolvesTo: "toxtricity"   },
  sizzlipede:  { level: 28, evolvesTo: "centiskorch"  },
  clobbopus:   { level: 35, evolvesTo: "grapploct"    },
  hatenna:     { level: 32, evolvesTo: "hattrem"      },
  hattrem:     { level: 42, evolvesTo: "hatterene"    },
  impidimp:    { level: 32, evolvesTo: "morgrem"      },
  morgrem:     { level: 42, evolvesTo: "grimmsnarl"   },
  snom:        { level: 40, evolvesTo: "frosmoth"     },
  cufant:      { level: 34, evolvesTo: "copperajah"   },
  dreepy:      { level: 50, evolvesTo: "drakloak"     },
  drakloak:    { level: 60, evolvesTo: "dragapult"    },
  "galarian-meowth": { level: 28, evolvesTo: "perrserker" },
  // Gen 9 (Paldea) ─────────────────────────────────────────────────────────────
  sprigatito:  { level: 16, evolvesTo: "floragato"    },
  floragato:   { level: 36, evolvesTo: "meowscarada"  },
  fuecoco:     { level: 16, evolvesTo: "crocalor"     },
  crocalor:    { level: 36, evolvesTo: "skeledirge"   },
  quaxly:      { level: 16, evolvesTo: "quaxwell"     },
  quaxwell:    { level: 36, evolvesTo: "quaquaval"    },
  lechonk:     { level: 18, evolvesTo: "oinkologne"   },
  tarountula:  { level: 15, evolvesTo: "spidops"      },
  nymble:      { level: 24, evolvesTo: "lokix"        },
  pawmi:       { level: 18, evolvesTo: "pawmo"        },
  pawmo:       { level: 32, evolvesTo: "pawmot"       },
  tandemaus:   { level: 25, evolvesTo: "maushold"     },
  fidough:     { level: 26, evolvesTo: "dachsbun"     },
  smoliv:      { level: 25, evolvesTo: "dolliv"       },
  dolliv:      { level: 35, evolvesTo: "arboliva"     },
  nacli:       { level: 24, evolvesTo: "naclstack"    },
  naclstack:   { level: 38, evolvesTo: "garganacl"    },
  wattrel:     { level: 25, evolvesTo: "kilowattrel"  },
  maschiff:    { level: 30, evolvesTo: "mabosstiff"   },
  shroodle:    { level: 28, evolvesTo: "grafaiai"     },
  bramblin:    { level: 30, evolvesTo: "brambleghast" },
  toedscool:   { level: 30, evolvesTo: "toedscruel"   },
  rellor:      { level: 29, evolvesTo: "rabsca"       },
  flittle:     { level: 35, evolvesTo: "espathra"     },
  tinkatink:   { level: 24, evolvesTo: "tinkatuff"    },
  tinkatuff:   { level: 38, evolvesTo: "tinkaton"     },
  wiglett:     { level: 26, evolvesTo: "wugtrio"      },
  finizen:     { level: 38, evolvesTo: "palafin"      },
  varoom:      { level: 40, evolvesTo: "revavroom"    },
  glimmet:     { level: 35, evolvesTo: "glimmora"     },
  greavard:    { level: 30, evolvesTo: "houndstone"   },
  cetoddle:    { level: 32, evolvesTo: "cetitan"      },
  frigibax:    { level: 35, evolvesTo: "arctibax"     },
  arctibax:    { level: 54, evolvesTo: "baxcalibur"   },
  gimmighoul:  { level: 40, evolvesTo: "gholdengo"    },
};

/**
 * Returns the Pokémon name to evolve into if the given Pokémon reaches the given level,
 * or null if no level-up evolution exists.
 */
export function getLevelEvolution(pokemonName, level) {
  const key = (pokemonName || "").toLowerCase().trim().replace(/ /g, "-");
  const evo = LEVEL_EVOLUTIONS[key] || LEVEL_EVOLUTIONS[key.replace(/-/g, " ")] || LEVEL_EVOLUTIONS[key.replace(/-/g, "_")];
  if (!evo) return null;
  return level >= evo.level ? evo.evolvesTo : null;
}

// ── Stone evolution map ───────────────────────────────────────────────────────
export const STONE_EVOLUTIONS = {
  // [fromName]: { stone: "stonetype", evolvesTo: "pokemon name" }
  pikachu:     { stone: "thunderstone",  evolvesTo: "raichu" },
  eevee:       [
    { stone: "firestone",    evolvesTo: "flareon"   },
    { stone: "waterstone",   evolvesTo: "vaporeon"  },
    { stone: "thunderstone", evolvesTo: "jolteon"   },
    { stone: "icestone",     evolvesTo: "glaceon"   },
    { stone: "shinystone",   evolvesTo: "sylveon"   },
  ],
  vulpix:       { stone: "firestone",   evolvesTo: "ninetales"    },
  growlithe:    { stone: "firestone",   evolvesTo: "arcanine"     },
  poliwhirl:    { stone: "waterstone",  evolvesTo: "poliwrath"    },
  shellder:     { stone: "waterstone",  evolvesTo: "cloyster"     },
  staryu:       { stone: "waterstone",  evolvesTo: "starmie"      },
  clefairy:     { stone: "moonstone",   evolvesTo: "clefable"     },
  jigglypuff:   { stone: "moonstone",   evolvesTo: "wigglytuff"   },
  nidorino:     { stone: "moonstone",   evolvesTo: "nidoking"     },
  nidorina:     { stone: "moonstone",   evolvesTo: "nidoqueen"    },
  gloom:        [
    { stone: "leafstone", evolvesTo: "vileplume" },
    { stone: "sunstone",  evolvesTo: "bellossom" },
  ],
  weepinbell:   { stone: "leafstone",   evolvesTo: "victreebel"   },
  exeggcute:    { stone: "leafstone",   evolvesTo: "exeggutor"    },
  sunkern:      { stone: "sunstone",    evolvesTo: "sunflora"     },
  togetic:      { stone: "shinystone",  evolvesTo: "togekiss"     },
  roselia:      { stone: "shinystone",  evolvesTo: "roserade"     },
  murkrow:      { stone: "duskstone",   evolvesTo: "honchkrow"    },
  misdreavus:   { stone: "duskstone",   evolvesTo: "mismagius"    },
  kirlia:       { stone: "dawnstone",   evolvesTo: "gallade"      },
  snorunt:      { stone: "dawnstone",   evolvesTo: "froslass"     },
  // Gen 4 additions
  lombre:       { stone: "waterstone",  evolvesTo: "ludicolo"     },
  nuzleaf:      { stone: "leafstone",   evolvesTo: "shiftry"      },
  skitty:       { stone: "moonstone",   evolvesTo: "delcatty"     },
  minun:        { stone: "thunderstone",evolvesTo: "minun"        },
  // Gen 5 additions
  munna:        { stone: "moonstone",   evolvesTo: "musharna"     },
  cottonee:     { stone: "sunstone",    evolvesTo: "whimsicott"   },
  petilil:      { stone: "sunstone",    evolvesTo: "lilligant"    },
  pansage:      { stone: "leafstone",   evolvesTo: "simisage"     },
  pansear:      { stone: "firestone",   evolvesTo: "simisear"     },
  panpour:      { stone: "waterstone",  evolvesTo: "simipour"     },
  // Gen 6 additions
  floette:      { stone: "shinystone",  evolvesTo: "florges"      },
  // Gen 8 (Galar) stone evolutions
  tadbulb:      { stone: "thunderstone",evolvesTo: "bellibolt"    },
  charcadet:    [
    { stone: "firestone",  evolvesTo: "armarouge" },
    { stone: "waterstone", evolvesTo: "ceruledge" },
  ],
  // Gen 9 (Paldea) stone evolutions
  capsakid:     { stone: "firestone",   evolvesTo: "scovillain"   },
  applin:       [
    { stone: "tartapple",  evolvesTo: "flapple"    },
    { stone: "sweetapple", evolvesTo: "appletun"   },
  ],
};

// Mega Evolution is driven by a species-specific Mega Stone plus an equipped
// Key Stone. The API uses the standard PokeAPI form names for the results.
export const MEGA_EVOLUTIONS = {
  abomasnow:  { abomasite: "mega-abomasnow" },
  absol:      { absolite: "mega-absol" },
  aerodactyl: { aerodactylite: "mega-aerodactyl" },
  aggron:     { aggronite: "mega-aggron" },
  alakazam:   { alakazite: "mega-alakazam" },
  altaria:    { altarianite: "mega-altaria" },
  ampharos:   { ampharosite: "mega-ampharos" },
  audino:     { audinite: "mega-audino" },
  banette:    { banettite: "mega-banette" },
  beedrill:   { beedrillite: "mega-beedrill" },
  blastoise:  { blastoisinite: "mega-blastoise" },
  blaziken:   { blazikenite: "mega-blaziken" },
  camerupt:   { cameruptite: "mega-camerupt" },
  charizard:  { charizarditex: "mega-charizard-x", charizarditey: "mega-charizard-y" },
  diancie:    { diancite: "mega-diancie" },
  gallade:    { galladite: "mega-gallade" },
  garchomp:   { garchompite: "mega-garchomp" },
  gardevoir:  { gardevoirite: "mega-gardevoir" },
  gengar:     { gengarite: "mega-gengar" },
  glalie:     { glalitite: "mega-glalie" },
  gyarados:   { gyaradosite: "mega-gyarados" },
  heracross:  { heracronite: "mega-heracross" },
  houndoom:   { houndoominite: "mega-houndoom" },
  kangaskhan: { kangaskhanite: "mega-kangaskhan" },
  latias:     { latiasite: "mega-latias" },
  latios:     { latiosite: "mega-latios" },
  lopunny:    { lopunnite: "mega-lopunny" },
  lucario:    { lucarionite: "mega-lucario" },
  manectric:  { manectite: "mega-manectric" },
  mawile:     { mawilite: "mega-mawile" },
  medicham:   { medichamite: "mega-medicham" },
  metagross:  { metagrossite: "mega-metagross" },
  mewtwo:     { mewtwonitex: "mega-mewtwo-x", mewtwonitey: "mega-mewtwo-y" },
  pidgeot:    { pidgeotite: "mega-pidgeot" },
  pinsir:     { pinsirite: "mega-pinsir" },
  sableye:    { sablenite: "mega-sableye" },
  salamence:  { salamencite: "mega-salamence" },
  sceptile:   { sceptilite: "mega-sceptile" },
  scizor:     { scizorite: "mega-scizor" },
  sharpedo:   { sharpedonite: "mega-sharpedo" },
  slowbro:    { slowbronite: "mega-slowbro" },
  steelix:    { steelixite: "mega-steelix" },
  swampert:   { swampertite: "mega-swampert" },
  tyranitar:  { tyranitarite: "mega-tyranitar" },
  venusaur:   { venusaurite: "mega-venusaur" },
};

export function isMegaEvolutionStone(stone) {
  const stoneKey = (stone || "").toLowerCase().trim();
  return Object.values(MEGA_EVOLUTIONS).some((stones) => stoneKey in stones);
}

export function getEvolutionByStone(pokemonName, stone) {
  const key = pokemonName.toLowerCase().trim();
  const megaEvolution = MEGA_EVOLUTIONS[key]?.[stone.toLowerCase()];
  if (megaEvolution) return megaEvolution;

  const evo = STONE_EVOLUTIONS[key];
  if (!evo) return null;
  if (Array.isArray(evo)) {
    const match = evo.find((e) => e.stone === stone.toLowerCase());
    return match ? match.evolvesTo : null;
  }
  return evo.stone === stone.toLowerCase() ? evo.evolvesTo : null;
}
