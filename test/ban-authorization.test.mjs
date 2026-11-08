import assert from "node:assert/strict";
import test from "node:test";
import { getBanTargetBlock } from "../lib/banAuthorization.mjs";
import banCommand from "../plugins/owner/ban.js";
import unbanCommand from "../plugins/owner/unban.js";

test("moderators can use both ban and unban commands", () => {
  for (const command of [banCommand, unbanCommand]) {
    assert.equal(command.category, "staff");
    assert.equal(command.isMod, true);
    assert.notEqual(command.isStaff, true);
  }
});

test("mods and staff can ban regular users", () => {
  assert.equal(getBanTargetBlock({ targetStaffLevel: 0 }), null);
});

test("mods and staff cannot ban moderators, staff, or level-three staff", () => {
  for (const level of [1, 2, 3]) {
    assert.equal(getBanTargetBlock({ targetStaffLevel: level }), "staff");
  }
  assert.equal(getBanTargetBlock({ targetIsMod: true }), "staff");
  assert.equal(getBanTargetBlock({ targetIsOwner: true }), "staff");
});

test("only the configured owner can override the staff protection", () => {
  assert.equal(getBanTargetBlock({
    isActualOwner: true,
    targetStaffLevel: 3,
  }), null);
});

test("staff-rank lookup failures fail closed for non-owners", () => {
  assert.equal(getBanTargetBlock({
    moderationStatusAvailable: false,
  }), "unavailable");
  assert.equal(getBanTargetBlock({
    isActualOwner: true,
    moderationStatusAvailable: false,
  }), null);
});
