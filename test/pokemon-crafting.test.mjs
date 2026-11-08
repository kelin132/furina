import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPokemonCraftIngredients,
  getPokemonCraftRecipe,
  POKEMON_CRAFT_RECIPES,
} from "../lib/pokemon/crafting.mjs";

test("craft recipes resolve by id and readable alias", () => {
  assert.equal(getPokemonCraftRecipe("great ball")?.output, "greatball");
  assert.equal(getPokemonCraftRecipe("paralyze-heal")?.output, "paralyzeheal");
  assert.equal(getPokemonCraftRecipe("not-an-item"), null);
});

test("craft recipes have safe positive quantities and material labels", () => {
  for (const recipe of POKEMON_CRAFT_RECIPES) {
    assert.ok(recipe.quantity > 0);
    assert.ok(Object.values(recipe.ingredients).every((quantity) => quantity > 0));
  }
  assert.equal(formatPokemonCraftIngredients({ iron_ore: 1, apricorn: 3 }), "1 iron ore + 3 apricorn");
});
