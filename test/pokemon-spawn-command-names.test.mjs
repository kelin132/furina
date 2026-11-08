import assert from "node:assert/strict";
import test from "node:test";
import autoSpawn from "../plugins/pokemon/pokespawn.js";
import manualSpawn from "../plugins/pokemon/spawnpoke.js";

test("pokespawn is the moderator-controlled automatic spawn toggle", () => {
  assert.equal(autoSpawn.name, "pokespawn");
  assert.equal(autoSpawn.isMod, true);
  assert.equal(autoSpawn.isAdmin, true);
  assert.equal(autoSpawn.aliases.includes("spawnpoke"), false);
});

test("spawnpoke is the player command for a manual encounter", () => {
  assert.equal(manualSpawn.name, "spawnpoke");
  assert.equal(manualSpawn.aliases.includes("wildpoke"), true);
  assert.equal(manualSpawn.isMod, undefined);
  assert.equal(manualSpawn.isAdmin, undefined);
});
