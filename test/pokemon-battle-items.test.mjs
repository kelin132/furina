import assert from "node:assert/strict";
import test from "node:test";
import { applyBattleItem, BATTLE_ITEM_EFFECTS } from "../lib/pokemon/battleItems.mjs";

test("every battle item has a use description and an implemented effect", () => {
  for (const [id, item] of Object.entries(BATTLE_ITEM_EFFECTS)) {
    assert.ok(item.name, `${id} should have a display name`);
    assert.ok(item.description.length > 20, `${id} should explain its effect`);
    assert.equal(applyBattleItem({ attack: 20, defense: 20 }, id).ok, true);
  }
});

test("battle items cannot be consumed twice by the same active Pokémon", () => {
  const first = applyBattleItem({ attack: 20, battleItemUses: [] }, "xattack");
  assert.equal(first.pokemon.attack, 30);
  assert.equal(applyBattleItem(first.pokemon, "xattack").reason, "already-used");
});

test("accuracy, guard, dodge and critical items set their one-use battle effects", () => {
  assert.equal(applyBattleItem({}, "xaccuracy").pokemon.accuracyBonus, 20);
  assert.equal(applyBattleItem({}, "guardspec").pokemon.guardSpec, true);
  assert.equal(applyBattleItem({}, "xspeed").pokemon.dodgeNextHit, true);
  assert.equal(applyBattleItem({}, "direhit").pokemon.criticalNext, true);
});
