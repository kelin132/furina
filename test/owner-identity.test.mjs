import assert from "node:assert/strict";
import test from "node:test";
import {
  matchesAnyOwnerPhone,
  matchesOwnerPhone,
  normalizeOwnerPhone,
  normalizeOwnerNumbers,
  resolveOwnerPhone,
} from "../lib/ownerIdentity.mjs";

test("the configured owner phone matches WhatsApp JID forms", () => {
  assert.equal(matchesOwnerPhone("27612345678@s.whatsapp.net", "+27612345678"), true);
  assert.equal(matchesOwnerPhone("27612345678:5@s.whatsapp.net", "27612345678"), true);
});

test("a different bot phone does not become owner by identity alone", () => {
  assert.equal(matchesOwnerPhone("27699999999@s.whatsapp.net", "27612345678"), false);
});

test("Discord platform IDs cannot match a phone owner number", () => {
  assert.equal(matchesOwnerPhone("discord:27612345678", "27612345678"), false);
});

test("phone normalization removes formatting", () => {
  assert.equal(normalizeOwnerPhone("+27 (612) 345-678"), "27612345678");
});

test("owner roster combines configured numbers and removes duplicates", () => {
  assert.deepEqual(
    normalizeOwnerNumbers(" +27 612 345 678,27612345679", "+27612345678", ["27612345680"]),
    ["27612345678", "27612345679", "27612345680"],
  );
});

test("configured owner numbers may be supplied as a comma-separated setting", () => {
  const owners = normalizeOwnerNumbers("+263 780 894 295,+27 628 114 340");
  assert.deepEqual(owners, ["263780894295", "27628114340"]);
  assert.equal(matchesAnyOwnerPhone("27628114340:2@s.whatsapp.net", owners), true);
  assert.equal(matchesAnyOwnerPhone("263780894295@s.whatsapp.net", owners), true);
  assert.equal(matchesAnyOwnerPhone("263700000000@s.whatsapp.net", owners), false);
});

test("OWNER_NUMBER takes priority over runtime and fallback settings", () => {
  assert.equal(resolveOwnerPhone({
    environment: "+27612345678",
    runtime: "27699999999",
    passed: "27688888888",
    settings: "27677777777",
  }), "27612345678");
});
