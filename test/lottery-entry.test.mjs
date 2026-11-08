import { beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { createMemoryDb } from "./support/memoryMongo.mjs";
import { getLotteryRound, findLotteryTicket, findAccountLotteryTicket, purchaseLotteryTicket, claimLotteryDraw } from "../lib/lotteryEntry.mjs";

const phone = "263771234567@s.whatsapp.net";
const other = "263779999999@s.whatsapp.net";
const discordId = "123456789012345678";
const discordKey = `discord:${discordId}`;
let db;
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/lib/mongo.mjs")) return { format: "module", shortCircuit: true, source: "export const getDb = () => globalThis.lotteryFixture;" };
    if (url.endsWith("/plugins/economy/database.js")) return { format: "module", shortCircuit: true, source: `
      export const requireRegistration = async () => true;
      export const addHistory = async () => {};
      export const getUser = async id => await globalThis.lotteryFixture.collection("users").findOne({_id:id}) || {money:0};
    ` };
    return nextLoad(url, context);
  },
});
const { default: command } = await import("../plugins/economy/lottery.js");
const { drawLottery } = await import("../lib/lotteryAutoDraw.mjs");
beforeEach(() => {
  db = createMemoryDb({
    users: [{ _id: phone, registered: true, money: 100000, name: "Player" }, { _id: other, registered: true, money: 100000 }],
    account_links: [{ _id: "verified-link", whatsappId: phone, discordId, status: "active" }],
    lottery: [{ _id: "current", roundId: "round-one", tickets: [], totalTickets: 0, jackpot: 10000000, createdAt: new Date(0) }],
  });
  globalThis.lotteryFixture = db;
});
const round = () => db.collection("lottery").findOne({ _id: "current" });
const buy = async (sender = phone, price = 500, lot) =>
  purchaseLotteryTicket({ db, sender, price, lot: lot ?? await round(), name: "Player" });
const wallet = () => db.data.users.find(user => user._id === phone).money;

test("matches legacy bare, full/device JID and Discord-backed tickets", () => {
  assert.ok(findLotteryTicket([{ userId: phone, count: 1 }], "263771234567"));
  assert.ok(findLotteryTicket([{ userId: "263771234567", count: 1 }], phone));
  assert.ok(findLotteryTicket([{ userId: "263771234567:2@s.whatsapp.net" }], phone));
  assert.ok(findLotteryTicket([{ userId: discordKey }], phone, discordId));
  assert.equal(findLotteryTicket([{ userId: discordKey }], `${discordId}@lid`), undefined);
});
test("WhatsApp purchase blocks Discord without a second charge", async () => {
  assert.ok((await buy(phone)).ok);
  assert.equal((await buy(discordKey)).reason, "duplicate");
  assert.equal(wallet(), 99500);
  assert.equal((await round()).tickets.length, 1);
});
test("Discord purchase blocks WhatsApp without a second charge", async () => {
  assert.ok((await buy(discordKey)).ok);
  assert.equal((await buy(phone)).reason, "duplicate");
  assert.equal(wallet(), 99500);
});
test("linking after a standalone Discord entry still blocks a WhatsApp entry", async () => {
  db.data.account_links.length = 0;
  db.data.users.push({ _id: discordKey, registered: true, money: 50000 });
  assert.ok((await buy(discordKey)).ok);
  db.data.account_links.push({ whatsappId: phone, discordId, status: "active" });
  assert.equal((await buy(phone)).reason, "duplicate");
  assert.equal(wallet(), 100000);
});
test("legacy LID tickets resolve through the user's verified phone alias", async () => {
  db.data.users.push({ _id: "54321@lid", phoneNumber: "263771234567", registered: true });
  db.data.lottery[0].tickets.push({ userId: "54321@lid", count: 1 });
  db.data.lottery[0].totalTickets = 1;
  assert.equal((await buy(discordKey)).reason, "duplicate");
});
test("simultaneous cross-platform purchases create one ticket and one net charge", async () => {
  const lot = await round();
  const results = await Promise.all([buy(phone, 10000, lot), buy(discordKey, 500, lot)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal((await round()).totalTickets, 1);
  assert.equal((await round()).tickets.length, 1);
  assert.equal(wallet(), results[0].ok ? 90000 : 99500);
});
test("concurrent purchases from different users do not overwrite tickets", async () => {
  const lot = await round();
  const results = await Promise.all([buy(phone, 500, lot), buy(other, 500, lot)]);
  assert.ok(results.every(result => result.ok));
  assert.equal((await round()).tickets.length, 2);
  assert.equal((await round()).totalTickets, 2);
  assert.equal((await round()).jackpot, 10001000);
});
test("a round accepts exactly sixteen tickets and refunds the seventeenth entry", async () => {
  const ticketPrice = 15_000;
  for (let index = 0; index < 16; index += 1) {
    const sender = `263771200${String(index).padStart(3, "0")}@s.whatsapp.net`;
    db.data.users.push({ _id: sender, registered: true, money: 50000 });
    const result = await purchaseLotteryTicket({
      db,
      lot: await round(),
      sender,
      price: ticketPrice,
      name: `Player ${index + 1}`,
    });
    assert.equal(result.ok, true, `ticket ${index + 1} should be accepted`);
  }
  const extra = "263771299999@s.whatsapp.net";
  db.data.users.push({ _id: extra, registered: true, money: 50000 });
  assert.equal((await round()).totalTickets, 16);
  assert.equal((await purchaseLotteryTicket({ db, lot: await round(), sender: extra, price: ticketPrice })).reason, "drawing");
  assert.equal((await db.collection("users").findOne({ _id: extra })).money, 50000);
  assert.equal((await round()).tickets.length, 16);
});
test("the draw waits for sixteen tickets, then pays three distinct winners", async () => {
  const tickets = Array.from({ length: 16 }, (_, index) => {
    const userId = `263771300${String(index).padStart(3, "0")}@s.whatsapp.net`;
    db.data.users.push({ _id: userId, registered: true, money: 0 });
    return { userId, count: 1, name: `Player ${index + 1}` };
  });
  const lottery = db.data.lottery[0];
  lottery.tickets = tickets.slice(0, 15);
  lottery.totalTickets = 15;
  assert.equal((await drawLottery({ db, minimumEntries: 16 })).reason, "minimum");
  lottery.tickets = tickets;
  lottery.totalTickets = 16;
  const result = await drawLottery({ db, minimumEntries: 16 });
  assert.equal(result.ok, true);
  assert.equal(result.totalTickets, 16);
  assert.equal(result.winners.length, 3);
  assert.equal(new Set(result.winners.map((winner) => winner.userId)).size, 3);
});
test("a draw allows re-entry in the new round but rejects stale-round writes", async () => {
  assert.ok((await buy()).ok);
  const stale = await round();
  const results = await Promise.all([drawLottery({ db }), drawLottery({ db })]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal((await round()).tickets.length, 0);
  const before = wallet();
  assert.equal((await buy(phone, 500, stale)).reason, "duplicate");
  assert.equal(wallet(), before);
  assert.ok((await buy(discordKey)).ok);
});
test("stale empty snapshots cannot insert into a different round or charge the user", async () => {
  const stale = await round();
  db.data.lottery[0].roundId = "round-two";
  assert.equal((await buy(phone, 500, stale)).reason, "drawing");
  assert.equal(wallet(), 100000);
  assert.equal((await round()).tickets.length, 0);
});
test("draw locks block buying and another worker's draw claim", async () => {
  const lot = await round();
  assert.ok(await claimLotteryDraw(db, lot));
  assert.equal(await claimLotteryDraw(db, lot), null);
  assert.equal((await buy()).reason, "drawing");
  assert.equal(wallet(), 100000);
});
test("insufficient funds never creates a ticket", async () => {
  db.data.users[0].money = 499;
  assert.equal((await buy()).reason, "funds");
  assert.equal((await round()).tickets.length, 0);
});
test("the actual command rejects a linked user's second platform purchase", async () => {
  const replies = [];
  const sock = { sendMessage: async (_, payload) => { replies.push(payload.text || payload.discordEmbed?.description); } };
  const msg = { key: { remoteJid: "fixture@g.us" } };
  await command.run({ sock, msg, sender: phone, args: [] });
  await command.run({ sock, msg, sender: phone, rawSender: discordId, args: [], discord: { message: { author: { id: discordId } } } });
  assert.match(replies[0], /bought a ticket for \$15,000, Goodluck!/i);
  assert.match(replies[1], /already/);
  assert.equal((await round()).tickets.length, 1);
  assert.ok(await findAccountLotteryTicket(db, (await round()).tickets, discordKey));
});
test("first-round initialization is shared rather than resetting existing entries", async () => {
  await buy();
  assert.equal((await getLotteryRound(db, 1234)).tickets.length, 1);
});
