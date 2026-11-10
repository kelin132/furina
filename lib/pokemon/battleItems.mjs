export const BATTLE_ITEM_EFFECTS = {
  xattack: {
    name: "X Attack",
    description: "Raises this Pokémon's battle attack by 50% until the battle ends.",
    apply: (pokemon) => ({ attack: Math.floor((pokemon.attack || 10) * 1.5) }),
  },
  xspatk: {
    name: "X Sp. Atk",
    description: "Raises this Pokémon's move damage by 30% until the battle ends.",
    apply: (pokemon) => ({ attack: Math.floor((pokemon.attack || 10) * 1.3) }),
  },
  xdefense: {
    name: "X Defense",
    description: "Raises this Pokémon's defense by 50% until the battle ends.",
    apply: (pokemon) => ({ defense: Math.floor((pokemon.defense || 10) * 1.5) }),
  },
  xspdef: {
    name: "X Sp. Def",
    description: "Raises this Pokémon's defense by 30% until the battle ends.",
    apply: (pokemon) => ({ defense: Math.floor((pokemon.defense || 10) * 1.3) }),
  },
  xspeed: {
    name: "X Speed",
    description: "Gives this Pokémon a 50% chance to dodge its next incoming hit.",
    apply: () => ({ dodgeNextHit: true }),
  },
  xaccuracy: {
    name: "X Accuracy",
    description: "Adds 20 percentage points to this Pokémon's next move accuracy.",
    apply: () => ({ accuracyBonus: 20 }),
  },
  guardspec: {
    name: "Guard Spec.",
    description: "Blocks the next battle status effect, including a stun.",
    apply: () => ({ guardSpec: true }),
  },
  direhit: {
    name: "Dire Hit",
    description: "Makes this Pokémon's next damaging move a critical hit.",
    apply: () => ({ criticalNext: true }),
  },
};

export function applyBattleItem(pokemon, itemId) {
  const item = BATTLE_ITEM_EFFECTS[itemId];
  if (!item) return { ok: false, reason: "unknown" };

  const uses = Array.isArray(pokemon.battleItemUses) ? pokemon.battleItemUses : [];
  if (uses.includes(itemId)) return { ok: false, reason: "already-used", item };

  const changes = item.apply(pokemon);
  return {
    ok: true,
    item,
    pokemon: {
      ...pokemon,
      ...changes,
      battleItemUses: [...uses, itemId],
    },
  };
}
