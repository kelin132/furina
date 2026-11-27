import test from "node:test";
import assert from "node:assert/strict";
import { fetchById, fetchByName, fetchRandom, fetchApiResource, getImageMessage, normalizePokemon, spriteUrl } from "../lib/pokemon/api.mjs";
import { fetchApiItem } from "../lib/pokemon/martItems.mjs";
import dex from "../plugins/pokemon/pokedex.js";
import search from "../plugins/pokemon/pokesearch.js";
import move from "../plugins/pokemon/pokemove.js";
import ability from "../plugins/pokemon/pokeability.js";

const fixture = {
  id: 25, Name: "Pikachu", Types: ["ELECTRIC"], Height: 0.4, Weight: 6,
  BaseStats: { hp: 35, attack: 55, defense: 40, speed: 90, specialAttack: 50, specialDefense: 50 },
  Abilities: ["STATIC"], Moves: [{ level: 1, move: "THUNDERSHOCK" }],
  moveDetails: [{ level: 1, move: "THUNDERSHOCK", details: { Power: 40 } }],
  Evolutions: [{ species: "RAICHU", method: "Item", parameter: "THUNDERSTONE" }],
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test("maps Eula fields, units and sprite URLs without losing detailed data", () => {
  const p = normalizePokemon(fixture);
  assert.equal(p.pokedexId, 25);
  assert.deepEqual(p.types, ["electric"]);
  assert.equal(p.baseAttack, 55);
  assert.equal(p.baseSpAtk, 50);
  assert.equal(p.baseSpDef, 50);
  assert.equal(p.height, 4);
  assert.equal(p.weight, 60);
  assert.equal(p.imageUrl, spriteUrl(25));
  assert.equal(p.backSpriteUrl, spriteUrl(25, true));
  assert.deepEqual(p.moveDetails, fixture.moveDetails);
  assert.deepEqual(p.evolutions, fixture.Evolutions);
  assert.throws(() => normalizePokemon({ error: "not found" }));
});

test("fetches names and IDs directly from /all and caches successful responses", async () => {
  const requests = [];
  const original = globalThis.fetch;
  globalThis.fetch = async url => { requests.push(String(url)); return json(fixture); };
  try {
    assert.equal((await fetchByName("Pikachu")).baseHp, 35);
    await fetchByName("Pikachu");
    await fetchById(25);
    assert.deepEqual(requests, [
      "https://pokeapi.eulaorg.app/api/pokemon/pikachu/all",
      "https://pokeapi.eulaorg.app/api/pokemon/25/all",
    ]);
  } finally { globalThis.fetch = original; }
});

test("resolves mega forms from the base species and retains the form's stats", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => String(url).includes("/charizard/all")
    ? json({ ...fixture, id: 6, Name: "Charizard", forms: [
      { form: 1, FormName: "Mega Charizard X", Types: ["FIRE", "DRAGON"], BaseStats: { attack: 130 } },
    ] }) : json({ error: "not found" }, 404);
  try {
    const p = await fetchByName("mega-charizard-x");
    assert.equal(p.pokedexId, 6);
    assert.equal(p.baseAttack, 130);
    assert.equal(p.form, 1);
    assert.equal(p.frontSpriteUrl, spriteUrl(6, false, false, 1));
  } finally { globalThis.fetch = original; }
});

test("random selection uses a valid species /all endpoint, not a nonexistent random endpoint", async () => {
  const original = globalThis.fetch;
  const random = Math.random;
  const requests = [];
  Math.random = () => 0.999999;
  globalThis.fetch = async url => { requests.push(String(url)); return json({ ...fixture, id: 1025 }); };
  try {
    assert.equal((await fetchRandom()).pokedexId, 1025);
    assert.deepEqual(requests, ["https://pokeapi.eulaorg.app/api/pokemon/1025/all"]);
  } finally { globalThis.fetch = original; Math.random = random; }
});

test("downloads shiny sprites from Eula, not stored legacy hosts", async () => {
  const original = globalThis.fetch;
  const png = Buffer.from([137, 80, 78, 71]);
  globalThis.fetch = async url => {
    assert.equal(String(url), spriteUrl(25, false, true));
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  };
  try {
    assert.deepEqual((await getImageMessage({ pokedexId: 25, shiny: true })).image, png);
  } finally { globalThis.fetch = original; }
});

test("maps Eula item names, descriptions and prices", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(String(url), "https://pokeapi.eulaorg.app/api/items/poke-ball");
    return json({ Name: "Poké Ball", Description: "Catches Pokémon.", Price: 200 });
  };
  try {
    assert.deepEqual(await fetchApiItem("poke-ball"), { displayName: "Poké Ball", effect: "Catches Pokémon.", apiCost: 200 });
  } finally { globalThis.fetch = original; }
});

test("commands consume Eula species, move and ability schemas", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith("https://pokeapi.eulaorg.app/api/"));
    return json(String(url).includes("/moves/")
      ? { Name: "Quick Attack", Type: "NORMAL", Power: 40, Accuracy: 100, TotalPP: 30, Description: "Strikes first." }
      : { Name: "Static", Description: "May paralyze on contact." });
  };
  const sent = [];
  const sock = { sendMessage: async (_jid, body) => { sent.push(body); } };
  const msg = { key: { remoteJid: "test" } };
  try {
    await dex.run({ sock, msg, args: ["pikachu"] });
    await search.run({ sock, msg, text: "pikachu" });
    await move.run({ sock, msg, text: "quick attack" });
    await ability.run({ sock, msg, text: "static" });
    const content = sent.map(b => b.caption || b.text || "").join("\n");
    assert.match(content, /PIKACHU/);
    assert.match(content, /QUICK ATTACK/);
    assert.match(content, /May paralyze/);
  } finally { globalThis.fetch = original; }
});

test("errors do not fall back to old providers or cache failures", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => {
    assert.ok(String(url).startsWith("https://pokeapi.eulaorg.app/"));
    calls++;
    return json({ error: "unavailable" }, 503);
  };
  try {
    await assert.rejects(fetchApiResource("moves", "failure"), /503/);
    await assert.rejects(fetchApiResource("moves", "failure"), /503/);
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
