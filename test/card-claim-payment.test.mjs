import assert from "node:assert/strict";
import test from "node:test";
import { persistChargedCardClaim } from "../lib/cardClaimPayment.mjs";

test("does not save a card when the wallet debit fails", async () => {
  let saved = false;
  const result = await persistChargedCardClaim({
    debit: async () => null,
    saveCard: async () => { saved = true; },
    hasCard: async () => false,
    refund: async () => {},
  });
  assert.equal(result.status, "insufficient");
  assert.equal(saved, false);
});

test("saves a card after the wallet debit succeeds", async () => {
  let saved = false;
  const result = await persistChargedCardClaim({
    debit: async () => ({ money: 900 }),
    saveCard: async () => { saved = true; },
    hasCard: async () => false,
    refund: async () => {},
  });
  assert.equal(result.status, "saved");
  assert.equal(result.wallet.money, 900);
  assert.equal(saved, true);
});

test("refunds when the card definitely was not saved", async () => {
  let refunded = false;
  const result = await persistChargedCardClaim({
    debit: async () => ({ money: 900 }),
    saveCard: async () => { throw new Error("write failed"); },
    hasCard: async () => false,
    refund: async () => { refunded = true; },
  });
  assert.equal(result.status, "refunded");
  assert.equal(refunded, true);
});

test("does not refund when the save result is uncertain", async () => {
  let refunded = false;
  const result = await persistChargedCardClaim({
    debit: async () => ({ money: 900 }),
    saveCard: async () => { throw new Error("write acknowledgement lost"); },
    hasCard: async () => { throw new Error("read failed"); },
    refund: async () => { refunded = true; },
  });
  assert.equal(result.status, "uncertain");
  assert.equal(refunded, false);
});
