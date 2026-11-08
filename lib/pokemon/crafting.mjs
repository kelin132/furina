const normalize = (value) => String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

export const POKEMON_CRAFT_RECIPES = Object.freeze([
  {
    id: "pokeball",
    name: "Poké Ball",
    output: "pokeball",
    quantity: 1,
    ingredients: { apricorn: 3, iron_ore: 1 },
    aliases: ["pokeball", "poke ball"],
  },
  {
    id: "greatball",
    name: "Great Ball",
    output: "greatball",
    quantity: 1,
    ingredients: { pokeball: 2, crystal_shard: 1 },
    aliases: ["greatball", "great ball"],
  },
  {
    id: "potion",
    name: "Potion",
    output: "potion",
    quantity: 1,
    ingredients: { medicinal_herb: 2 },
    aliases: ["potion"],
  },
  {
    id: "paralyzeheal",
    name: "Paralyze Heal",
    output: "paralyzeheal",
    quantity: 1,
    ingredients: { medicinal_herb: 1, crystal_shard: 1 },
    aliases: ["paralyzeheal", "paralyze heal"],
  },
]);

export function getPokemonCraftRecipe(value) {
  const query = normalize(value);
  return POKEMON_CRAFT_RECIPES.find((recipe) =>
    normalize(recipe.id) === query || recipe.aliases.some((alias) => normalize(alias) === query)
  ) ?? null;
}

export function formatPokemonCraftIngredients(ingredients) {
  return Object.entries(ingredients)
    .map(([item, quantity]) => `${quantity} ${item.replace(/_/g, " ")}`)
    .join(" + ");
}
