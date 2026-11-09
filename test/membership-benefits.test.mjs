import test from "node:test";
import assert from "node:assert/strict";
import { bankLimitForUser } from "../plugins/economy/currency.js";
import {
  commandCooldownMultiplier,
  harareDateKey,
  membershipDailyRenameLimit,
  membershipWinRate,
} from "../lib/membershipBenefits.mjs";
import { getEconomyPreviewConfig } from "../lib/economyPreview.mjs";
import activate from "../plugins/owner/activate.js";

test("membership tiers adjust bank space and command cooldowns", () => {
  assert.equal(bankLimitForUser({ level: 1, membershipTier: "basic" }), 150_000_000);
  assert.equal(bankLimitForUser({ level: 1, membershipTier: "premium" }), Number.MAX_SAFE_INTEGER);
  assert.equal(bankLimitForUser({ level: 2 }), 70_000);
  assert.equal(commandCooldownMultiplier("basic"), 0.6);
  assert.equal(commandCooldownMultiplier("premium"), 0);
  assert.equal(commandCooldownMultiplier("none"), 1);
  assert.equal(membershipWinRate(0.5, "basic"), 0.55);
  assert.equal(membershipWinRate(0.5, "premium"), 0.6);
  assert.equal(membershipWinRate(0.92, "premium"), 0.95);
  assert.equal(membershipDailyRenameLimit("basic"), 5);
  assert.equal(membershipDailyRenameLimit("none"), 1);
  assert.equal(membershipDailyRenameLimit("premium"), Number.MAX_SAFE_INTEGER);
  assert.equal(harareDateKey(new Date("2026-11-08T22:30:00.000Z")), "2026-11-09");
});

test("membership links to the public page and activation is available to owner-role staff", () => {
  assert.equal(getEconomyPreviewConfig("membership")?.url, "https://aidoru.zone.id/membership");
  assert.equal(activate.strictOwner, undefined);
  assert.equal(activate.isOwner, true);
});
