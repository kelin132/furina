import test from "node:test";
import assert from "node:assert/strict";
import {
  HIGH_WEALTH_TAX_RATE,
  STANDARD_TAX_RATE,
  TAX_INTERVAL_MS,
  TAX_WEALTH_THRESHOLD,
  nextTaxRunAt,
  taxRateForWealth,
  wealthTaxExpression,
} from "../lib/taxRules.mjs";

test("automatic tax is off unless explicitly enabled", () => {
  assert.equal(nextTaxRunAt(null, 1_000), null);
  assert.equal(nextTaxRunAt({ lastRun: 1_000 }, 2_000), null);
  assert.equal(nextTaxRunAt({ enabled: false, nextRunAt: 1_000 }, 2_000), null);
});

test("enabling automatic tax schedules the first run one interval later", () => {
  assert.equal(
    nextTaxRunAt({ enabled: true }, 1_000),
    1_000 + TAX_INTERVAL_MS,
  );
});

test("automatic tax respects a persisted next-run time", () => {
  assert.equal(
    nextTaxRunAt({ enabled: true, nextRunAt: 99_000 }, 1_000),
    99_000,
  );
});

test("legacy enabled schedules fall back to the last collection timestamp", () => {
  assert.equal(
    nextTaxRunAt({ enabled: true, lastRun: 1_000 }, 2_000),
    1_000 + TAX_INTERVAL_MS,
  );
});

test("the 20% rate starts at exactly $300 million total wealth", () => {
  assert.equal(taxRateForWealth(TAX_WEALTH_THRESHOLD - 1), STANDARD_TAX_RATE);
  assert.equal(taxRateForWealth(TAX_WEALTH_THRESHOLD), HIGH_WEALTH_TAX_RATE);
  assert.equal(taxRateForWealth(TAX_WEALTH_THRESHOLD + 1), HIGH_WEALTH_TAX_RATE);
});

test("the top two leaderboard users receive the 20% tax rate at any wealth", () => {
  assert.equal(taxRateForWealth(1, true), HIGH_WEALTH_TAX_RATE);
  assert.equal(taxRateForWealth(299_999_999, false), STANDARD_TAX_RATE);
});

test("the Mongo tax rule measures wealth as wallet plus bank", () => {
  assert.deepEqual(wealthTaxExpression(["rich-1", "rich-2"]), {
    $cond: [
      {
        $or: [
          {
            $gte: [
              {
                $add: [
                  { $ifNull: ["$money", 0] },
                  { $ifNull: ["$bank", 0] },
                ],
              },
              TAX_WEALTH_THRESHOLD,
            ],
          },
          { $in: ["$_id", ["rich-1", "rich-2"]] },
        ],
      },
      HIGH_WEALTH_TAX_RATE,
      STANDARD_TAX_RATE,
    ],
  });
});
