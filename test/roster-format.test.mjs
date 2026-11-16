import assert from "node:assert/strict";
import test from "node:test";
import { formatAidoruRoster } from "../lib/rosterFormat.mjs";

test("formats bot and staff rosters with one AIDORU header", () => {
  const text = formatAidoruRoster("BOTS", [
    { rows: ["🟢 ALYA · WhatsApp"] },
  ]);
  assert.match(text, /AIDORU/);
  assert.match(text, /BOTS/);
  assert.match(text, /ALYA/);
  assert.doesNotMatch(text, /TENSURA|AKIRA BOTS/i);
});

test("keeps empty roster groups readable", () => {
  const text = formatAidoruRoster("STAFF & MODS", [
    { title: "MODS", rows: [] },
  ]);
  assert.match(text, /MODS/);
  assert.match(text, /None listed/);
});
