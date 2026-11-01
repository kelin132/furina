import test from "node:test";
import assert from "node:assert/strict";
import { getCommandAccessBlock } from "../lib/commandAccess.mjs";

test("banned players are blocked", () => {
  assert.equal(getCommandAccessBlock({ isBanned: true }), "banned");
});

test("jailed players are blocked from every command", () => {
  assert.equal(getCommandAccessBlock({ isJailed: true }), "jailed");
});

test("unavailable moderation status fails closed", () => {
  assert.equal(
    getCommandAccessBlock({ moderationStatusAvailable: false }),
    "unavailable",
  );
});

test("the owner can still manage bans and jail", () => {
  assert.equal(
    getCommandAccessBlock({ isOwner: true, isBanned: true, isJailed: true }),
    null,
  );
});
