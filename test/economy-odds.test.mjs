import test from "node:test";
import assert from "node:assert/strict";
import {
  ECONOMY_WIN_RATE_PENALTY,
  ECONOMY_WIN_RATE_WEALTH_THRESHOLD,
  economyWinRate,
} from "../lib/economyOdds.mjs";

test("economy win rate is unchanged below $200 million", () => {
  assert.equal(economyWinRate(0.55, { money: ECONOMY_WIN_RATE_WEALTH_THRESHOLD - 1 }), 0.55);
});

test("reaching $200 million reduces win rate by nine percentage points", () => {
  assert.equal(
    economyWinRate(0.55, { money: ECONOMY_WIN_RATE_WEALTH_THRESHOLD }),
    0.55 - ECONOMY_WIN_RATE_PENALTY,
  );
});

test("wealth from wallet and bank is combined, with legacy totalWealth fallback", () => {
  assert.equal(economyWinRate(0.6, { money: 100_000_000, bank: 100_000_000 }), 0.51);
  assert.equal(economyWinRate(0.6, { totalWealth: 200_000_000 }), 0.51);
});

test("wealth penalty never makes a win chance negative", () => {
  assert.equal(economyWinRate(0.05, { money: 200_000_000 }), 0);
});
