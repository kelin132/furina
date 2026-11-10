import assert from "node:assert/strict";
import test from "node:test";
import { FISH_LOOT } from "../plugins/economy/_items.js";

test("fishing can award both standard and Great Poké Balls", () => {
  const catches = FISH_LOOT.filter((entry) => entry.type === "pokemon_ball").map((entry) => entry.name);
  assert.ok(catches.includes("pokeball"));
  assert.ok(catches.includes("greatball"));
});
