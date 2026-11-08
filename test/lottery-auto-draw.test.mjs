import test from "node:test";
import assert from "node:assert/strict";
import {
  LOTTERY_MAX_ENTRIES,
  getWhatsAppParticipantId,
  lotteryWinnerIdentity,
  lotteryWinnerLabel,
  pickLotteryWinners,
} from "../lib/lotteryAutoDraw.mjs";

test("lottery draws after sixteen one-ticket participants", () => {
  assert.equal(LOTTERY_MAX_ENTRIES, 16);
});

test("lottery winner selection uses bounded random rolls and never repeats a ticket", () => {
  const tickets = Array.from({ length: 16 }, (_, index) => ({ userId: `player-${index}`, count: 1 }));
  const bounds = [];
  const winners = pickLotteryWinners(tickets, 3, (upperBound) => {
    bounds.push(upperBound);
    return upperBound - 1;
  });
  assert.deepEqual(bounds, [16, 15, 14]);
  assert.equal(new Set(winners.map((ticket) => ticket.userId)).size, 3);
  assert.deepEqual(winners.map((ticket) => ticket.userId), ["player-15", "player-14", "player-13"]);
});

test("normalizes WhatsApp phone mentions to a full Baileys JID", () => {
  assert.equal(getWhatsAppParticipantId("263771234567@s.whatsapp.net"), "263771234567@s.whatsapp.net");
  assert.equal(getWhatsAppParticipantId("263771234567"), "263771234567@s.whatsapp.net");
});

test("does not turn a Discord identity into a WhatsApp number", () => {
  const ticket = { userId: "discord:123456789012345678", name: "DiscordName" };
  assert.equal(getWhatsAppParticipantId(ticket.userId), null);
  assert.equal(lotteryWinnerIdentity(ticket), "discord:123456789012345678");
  assert.equal(lotteryWinnerLabel(ticket), "DiscordName");
});

test("shows a WhatsApp winner by phone mention and readable name", () => {
  assert.equal(lotteryWinnerLabel({ userId: "263771234567", name: "Kelin" }), "@263771234567 (Kelin)");
});
