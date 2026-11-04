import assert from "node:assert/strict";
import test from "node:test";
import {
  canGrantStaffLevel3,
  canRunOwnerCommand,
  hasOwnerRole,
} from "../lib/ownerRoleAccess.mjs";

test("staff level 3 has the owner role, but level 2 does not", () => {
  assert.equal(hasOwnerRole(false, 3), true);
  assert.equal(hasOwnerRole(false, 2), false);
});

test("only the configured owner and level-3 staff can grant level 3", () => {
  assert.equal(canGrantStaffLevel3(true, 0), true);
  assert.equal(canGrantStaffLevel3(false, 3), true);
  assert.equal(canGrantStaffLevel3(false, 2), false);
  assert.equal(canGrantStaffLevel3(false, 1), false);
});

test("owner commands allow level 3 and the configured bot owner", () => {
  const command = { isOwner: true };
  assert.equal(canRunOwnerCommand(command, false, 3), true);
  assert.equal(canRunOwnerCommand(command, true, 0), true);
  assert.equal(canRunOwnerCommand(command, false, 2), false);
});

test("owner-category commands allow level 3 but not lower staff", () => {
  const command = { category: "owner" };
  assert.equal(canRunOwnerCommand(command, false, 3), true);
  assert.equal(canRunOwnerCommand(command, false, 2), false);
});

test("strict owner commands remain limited to the configured bot owner", () => {
  const command = { isOwner: true, strictOwner: true };
  assert.equal(canRunOwnerCommand(command, false, 3), false);
  assert.equal(canRunOwnerCommand(command, true, 0), true);
});

test("the public mods roster is not treated as an owner command", () => {
  const command = { category: "owner", public: true };
  assert.equal(canRunOwnerCommand(command, false, 0), true);
});
