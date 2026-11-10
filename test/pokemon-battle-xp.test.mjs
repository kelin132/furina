import assert from "node:assert/strict";
import test from "node:test";
import { pvpXpReward, xpReward } from "../lib/pokemon/gameLogic.mjs";

test("wild knockout XP is increased by 50 percent", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(xpReward({ level: 10 }), Math.floor((10 * 135 + 75) * 1.5));
  } finally {
    Math.random = originalRandom;
  }
});

test("PvP knockout XP is increased by 50 percent", () => {
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    assert.equal(pvpXpReward({ level: 10 }, { level: 10 }), Math.floor((250 + 10 * 100 + 10 * 10 * 7) * 1.5));
  } finally {
    Math.random = originalRandom;
  }
});
