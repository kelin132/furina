import assert from "node:assert/strict";
import test from "node:test";
import { pickRandomTier, TIER_WEIGHTS } from "../lib/cardApi.mjs";

test("every configured card tier can be selected by the weighted spawn picker", () => {
  const total = TIER_WEIGHTS.reduce((sum, tier) => sum + tier.weight, 0);
  let precedingWeight = 0;
  for (const tier of TIER_WEIGHTS) {
    const sample = (precedingWeight + tier.weight / 2) / total;
    assert.equal(pickRandomTier(() => sample), tier.num);
    precedingWeight += tier.weight;
  }
});

test("the picker can limit its choices to tiers present in a catalog", () => {
  const available = TIER_WEIGHTS.filter((tier) => ["1", "X"].includes(tier.num));
  assert.equal(pickRandomTier(() => 0.99, available), "X");
});
