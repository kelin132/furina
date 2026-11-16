import assert from "node:assert/strict";
import test from "node:test";
import { selectSeriesCards } from "../lib/cardSeriesTransfer.mjs";

test("selects all unlocked cards from the requested series, case-insensitively", () => {
  const cards = [
    { cardId: "a", series: "Sky Saga" },
    { cardId: "b", series: "sky saga", locked: true },
    { cardId: "c", series: "Other Saga" },
  ];
  const result = selectSeriesCards(cards, "SKY SAGA");
  assert.equal(result.status, "ok");
  assert.equal(result.series, "Sky Saga");
  assert.deepEqual(result.eligible.map((card) => card.cardId), ["a"]);
  assert.deepEqual(result.blocked.map((card) => card.cardId), ["b"]);
});

test("reports ambiguous partial series queries instead of choosing one", () => {
  const result = selectSeriesCards([
    { series: "Moon Saga" },
    { series: "Moonlight Stories" },
  ], "moon");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(result.matches, ["Moon Saga", "Moonlight Stories"]);
});

test("does not offer cards currently in an auction", () => {
  const result = selectSeriesCards([
    { cardId: "a", series: "Sky Saga", inAuction: true },
  ], "Sky Saga");
  assert.equal(result.status, "ok");
  assert.equal(result.eligible.length, 0);
  assert.equal(result.blocked.length, 1);
});

test("returns missing when the sender does not own a matching series", () => {
  assert.equal(
    selectSeriesCards([{ series: "Sky Saga" }], "Ocean").status,
    "missing",
  );
});
