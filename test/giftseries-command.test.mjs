import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const accountMap = new Map();
const saveFailures = new Map();
globalThis.__giftSeriesTestState = { accountMap, saveFailures };

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/plugins/cards/db.js")) {
      return {
        format: "module",
        shortCircuit: true,
        source: `
          export function uid(value) { return String(value).split("@")[0]; }
          export async function findOrCreateUser(id) {
            const source = globalThis.__giftSeriesTestState.accountMap.get(id);
            if (!source) throw new Error("account missing");
            return {
              cards: structuredClone(source.cards),
              totalCards: source.cards.length,
              async save() {
                const failures = globalThis.__giftSeriesTestState.saveFailures;
                const remaining = failures.get(id) || 0;
                if (remaining > 0) {
                  failures.set(id, remaining - 1);
                  throw new Error("simulated collection conflict");
                }
                source.cards = structuredClone(this.cards);
                source.totalCards = this.cards.length;
              },
            };
          }
        `,
      };
    }
    if (url.endsWith("/lib/cardApi.mjs")) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export function formatCardLabel(card) { return card.name; }",
      };
    }
    if (url.endsWith("/lib/identity.mjs")) {
      return {
        format: "module",
        shortCircuit: true,
        source: "export function normalizeJid(value) { return String(value); }",
      };
    }
    return nextLoad(url, context);
  },
});

const { default: giftSeries } = await import("../plugins/cards/giftseries.js");

function setupAccounts() {
  accountMap.clear();
  saveFailures.clear();
  accountMap.set("sender@s.whatsapp.net", {
    cards: [
      { cardId: "sky-1", name: "Sky One", series: "Sky Saga" },
      { cardId: "sky-2", name: "Sky Two", series: "Sky Saga", locked: true },
      { cardId: "other-1", name: "Other", series: "Other Saga" },
    ],
    totalCards: 3,
  });
  accountMap.set("recipient@s.whatsapp.net", { cards: [], totalCards: 0 });
}

function runCommand() {
  const sent = [];
  const sock = {
    async sendMessage(chat, content) {
      sent.push({ chat, content });
      return content;
    },
  };
  const msg = {
    key: { remoteJid: "group@g.us" },
    message: {
      extendedTextMessage: {
        contextInfo: { mentionedJid: ["recipient@s.whatsapp.net"] },
      },
    },
  };
  return giftSeries.run({
    sock,
    msg,
    args: ["Sky", "Saga", "@recipient"],
    sender: "sender@s.whatsapp.net",
  }).then(() => sent);
}

test("gifts owned unlocked cards in the chosen series and retains locked cards", async () => {
  setupAccounts();
  const sent = await runCommand();
  assert.deepEqual(
    accountMap.get("sender@s.whatsapp.net").cards.map((card) => card.cardId),
    ["sky-2", "other-1"],
  );
  assert.deepEqual(
    accountMap.get("recipient@s.whatsapp.net").cards.map((card) => card.cardId),
    ["sky-1"],
  );
  assert.match(sent[0].content.text, /1 locked or auction card/);
  assert.deepEqual(sent[0].content.mentions, [
    "sender@s.whatsapp.net",
    "recipient@s.whatsapp.net",
  ]);
});

test("restores the sender collection when the recipient save fails", async () => {
  setupAccounts();
  saveFailures.set("recipient@s.whatsapp.net", 1);
  const sent = await runCommand();
  assert.deepEqual(
    accountMap.get("sender@s.whatsapp.net").cards.map((card) => card.cardId),
    ["sky-1", "sky-2", "other-1"],
  );
  assert.deepEqual(accountMap.get("recipient@s.whatsapp.net").cards, []);
  assert.match(sent.at(-1).content.text, /could not be completed/);
});
