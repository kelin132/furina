import test from "node:test";
import assert from "node:assert/strict";
import { bankLimitForUser } from "../plugins/economy/currency.js";
import { commandCooldownMultiplier } from "../lib/membershipBenefits.mjs";
import { getEconomyPreviewConfig } from "../lib/economyPreview.mjs";
import activate from "../plugins/owner/activate.js";

test("membership tiers adjust bank space and command cooldowns", () => {
  assert.equal(bankLimitForUser({ level: 1, membershipTier: "basic" }), 150_000_000);
  assert.equal(bankLimitForUser({ level: 1, membershipTier: "premium" }), Number.MAX_SAFE_INTEGER);
  assert.equal(bankLimitForUser({ level: 2 }), 70_000);
  assert.equal(commandCooldownMultiplier("basic"), 0.6);
  assert.equal(commandCooldownMultiplier("premium"), 0);
  assert.equal(commandCooldownMultiplier("none"), 1);
});

test("membership links to the public page and activation is strict-owner only", () => {
  assert.equal(getEconomyPreviewConfig("membership")?.url, "https://aidoru.zone.id/membership");
  assert.equal(activate.strictOwner, true);
  assert.equal(activate.isOwner, true);
});
