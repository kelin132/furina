import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const writes = [];
const account = {
  _id: "123456789@lid", registered: true, name: "Trainer",
  phoneNumber: "263771234567", websiteId: "AID-E225E6E134",
  money: 1234, bank: 50, inventory: [],
};
const collection = {
  find() { return { toArray: async () => [{ ...account }] }; },
  async findOne(query) {
    if (query._id) return query._id === account._id ? { ...account } : null;
    return { ...account };
  },
  async updateOne(query, update) {
    writes.push({ query, update });
    return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
  },
  async findOneAndUpdate(query, update, options) {
    writes.push({ query, update, options });
    return globalThis.__debitWalletResult ?? null;
  },
  async updateMany() { return { modifiedCount: 0 }; },
  async insertOne() { throw new Error("Must not copy an account's unique websiteId"); },
  async deleteOne() { throw new Error("Must not delete a signed-in account"); },
  listIndexes() { return { async toArray() {
    return [{ name: "users_websiteId_unique", key: { websiteId: 1 }, unique: true, sparse: true }];
  } }; },
};
globalThis.__identityTestDb = { collection: name => name === "users" ? collection : {
  ...collection, find() { return { toArray: async () => [] }; },
  findOne: async () => null,
} };
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/lib/mongo.mjs")) return {
      format: "module", shortCircuit: true,
      source: "export function getDb() { return globalThis.__identityTestDb; }",
    };
    return nextLoad(url, context);
  },
});
const {
  getUser, saveUser, addMoney, debitWalletIfAvailable, setAuctionHold, clearAuctionHold, isRegistered, setStaffLevel,
} = await import("../plugins/economy/database.js");
const {
  activeAuctionHoldAmount,
  hasActiveAuctionHolds,
} = await import("../lib/auctionHolds.mjs");
const {
  migrateLidData,
  normalizeJid,
  resolveMessageSender,
  whatsappIdentityVariants,
} = await import("../lib/identity.mjs");
const { getOrCreateWebsiteId } = await import("../lib/websiteAuth.mjs");

test("legacy account reads and saves keep the original key and unique website ID", async () => {
  writes.length = 0;
  const user = await getUser("263771234567@s.whatsapp.net");
  assert.equal(user.money, 1234);
  assert.equal(user.websiteId, account.websiteId);
  user.money += 10;
  user.auctionHolds = { staleSnapshot: { expiresAt: Date.now() + 60_000 } };
  await saveUser("263771234567@s.whatsapp.net", user);
  const save = writes.find(({ update }) => update.$inc?.money === 10);
  assert.equal(save.query._id, account._id);
  assert.equal(save.update.$set?.auctionHolds, undefined);
  assert.equal(await isRegistered("263771234567@s.whatsapp.net"), true);
});

test("direct balance changes resolve the stored identity", async () => {
  writes.length = 0;
  await addMoney("263771234567@s.whatsapp.net", 25);
  assert.equal(writes[0].query._id, account._id);
});

test("staff rank writes resolve a phone alias to the registered LID account without upsert", async () => {
  writes.length = 0;
  assert.equal(await setStaffLevel("263771234567@s.whatsapp.net", 1), true);
  const staffWrite = writes.find(({ update }) => update.$set?.staffLevel === 1);
  assert.equal(staffWrite.query._id, account._id);
  assert.equal(staffWrite.query.registered, true);
  assert.equal(staffWrite.options?.upsert, undefined);
});

test("staff rank writes preserve the registered account's raw database id", async () => {
  writes.length = 0;
  const originalId = account._id;
  const objectId = { toString: () => "507f1f77bcf86cd799439011" };
  account._id = objectId;
  try {
    assert.equal(await setStaffLevel(objectId, 3), true);
    const staffWrite = writes.find(({ update }) => update.$set?.staffLevel === 3);
    assert.equal(staffWrite.query._id, objectId);
    assert.equal(staffWrite.query.registered, true);
  } finally {
    account._id = originalId;
  }
});

test("auction debits use an atomic balance condition on the existing phone/LID account", async () => {
  writes.length = 0;
  globalThis.__debitWalletResult = { ...account, money: 734, bank: 50 };
  const result = await debitWalletIfAvailable("263771234567@s.whatsapp.net", 500);
  assert.deepEqual(result, { money: 734, bank: 50 });
  const debit = writes.find(({ update }) => Array.isArray(update));
  assert.equal(debit.query._id, account._id);
  assert.equal(debit.query.registered, true);
  assert.equal(debit.query.$expr.$gte[1], 500);
  assert.equal(debit.options.returnDocument, "after");
  assert.equal(debit.update[0].$set.money.$subtract[1], 500);

  globalThis.__debitWalletResult = null;
  assert.equal(await debitWalletIfAvailable("263771234567@s.whatsapp.net", 500), null);
  assert.equal(await debitWalletIfAvailable("263771234567@s.whatsapp.net", -1), null);
});

test("auction holds update only one hashed field on the existing wallet and can be cleared", async () => {
  writes.length = 0;
  assert.equal(await setAuctionHold("263771234567@s.whatsapp.net", "whatsapp:group@g.us", 900, 50_000), true);
  const set = writes.find(({ update }) => Object.keys(update.$set || {}).some((key) => key.startsWith("auctionHolds.")));
  assert.equal(set.query._id, account._id);
  const field = Object.keys(set.update.$set)[0];
  assert.match(field, /^auctionHolds\.[a-f0-9]{32}$/);
  assert.deepEqual(set.update.$set[field], {
    auctionId: "whatsapp:group@g.us",
    amount: 900,
    expiresAt: 50_000,
  });

  writes.length = 0;
  assert.equal(await clearAuctionHold("263771234567@s.whatsapp.net", "whatsapp:group@g.us"), true);
  const clear = writes.find(({ update }) => update.$unset);
  assert.deepEqual(Object.keys(clear.update.$unset), [field]);
});

test("active bid holds are recognized only until their recovery expiry", () => {
  assert.equal(hasActiveAuctionHolds({ auctionHolds: { one: { expiresAt: 101 } } }, 100), true);
  assert.equal(hasActiveAuctionHolds({ auctionHolds: { one: { expiresAt: 100 } } }, 100), false);
  assert.equal(hasActiveAuctionHolds({ auctionHolds: { legacy: { amount: 500 } } }, 100), false);
  const holds = {
    first: { auctionId: "wa:one", amount: 500, expiresAt: 200 },
    second: { auctionId: "dc:two", amount: 250, expiresAt: 200 },
  };
  assert.equal(activeAuctionHoldAmount({ auctionHolds: holds }, 100), 750);
  assert.equal(activeAuctionHoldAmount({ auctionHolds: holds }, 100, "wa:one"), 250);
});

test("verified LID mapping retains the website account without copying or deleting it", async () => {
  writes.length = 0;
  // Only legacy auxiliary collections are absent in this fixture.
  globalThis.__identityTestDb = {
    collection: (name) => name === "users" || name === "mn_users"
      ? collection : { find: () => ({ toArray: async () => [] }), findOne: async () => null, updateMany: async () => ({ modifiedCount: 0 }) },
  };
  await migrateLidData(account._id, "263771234567@s.whatsapp.net");
  assert.equal(writes[0].query._id, account._id);
  assert.deepEqual(writes[0].update.$addToSet.identityAliases.$each,
    [account._id, "263771234567@s.whatsapp.net"]);
});

test("website ID commands find the stable legacy account", async () => {
  assert.equal(await getOrCreateWebsiteId("263771234567@s.whatsapp.net"), account.websiteId);
});

test("Discord keys stay namespaced instead of turning into fake WhatsApp IDs", () => {
  const id = "discord:123456789012345678";
  assert.equal(normalizeJid(id), id);
  assert.deepEqual(whatsappIdentityVariants(id), [id]);
});

test("formatted international phone numbers normalize to their canonical WhatsApp JID", () => {
  assert.equal(normalizeJid("+234 916 880 8440"), "2349168808440@s.whatsapp.net");
  assert.deepEqual(whatsappIdentityVariants("+234 916 880 8440").slice(0, 2), [
    "+234 916 880 8440",
    "2349168808440@s.whatsapp.net",
  ]);
});

test("incoming WhatsApp LIDs resolve to their verified phone before economy checks", async () => {
  const resolved = await resolveMessageSender(
    account._id,
    "",
    { signalRepository: { lidMapping: { getPNForLID: async () => "263771234567@s.whatsapp.net" } } },
    "fixture@g.us",
  );
  assert.equal(resolved, "263771234567@s.whatsapp.net");
});
