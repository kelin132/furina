import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { registerHooks } from "node:module";
import { getCardClaimId } from "../lib/cardClaimId.mjs";

globalThis.activeSpawns = {};
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/plugins/cards/db.js")) return {
      format: "module",
      shortCircuit: true,
      source: `export const findOrCreateUser = async () => globalThis.cardClaimProfile;
        export const getUser = async () => globalThis.cardClaimSavedProfile || null;`,
    };
    if (url.endsWith("/plugins/economy/database.js")) return {
      format: "module",
      shortCircuit: true,
      source: `export const debitWalletIfAvailable = async (_id, amount) => {
        if (globalThis.cardClaimWallet < amount) return null;
        globalThis.cardClaimWallet -= amount;
        return { money: globalThis.cardClaimWallet, bank: 0 };
      };
      export const addMoney = async (_id, amount) => { globalThis.cardClaimWallet += amount; };
      export const addHistory = async () => {};`,
    };
    if (url.endsWith("/lib/cardApi.mjs")) return {
      format: "module",
      shortCircuit: true,
      source: `export const formatCardLabel = (card) => \`🃏 \${card.name} (\${card.tier})\`;
        export const sendCardMedia = async () => {};`,
    };
    return nextLoad(url, context);
  },
});

const { default: claim } = await import("../plugins/cards/claim.js");
const card = {
  name: "Wallet Test Card",
  tier: "Rare",
  tierNum: "3",
  cardId: "wallet-test-card",
  price: 120,
};

beforeEach(() => {
  for (const key of Object.keys(globalThis.activeSpawns)) delete globalThis.activeSpawns[key];
  globalThis.cardClaimWallet = 500;
  globalThis.cardClaimSavedProfile = null;
  globalThis.cardClaimProfile = {
    cards: [],
    pendingCards: [],
    totalCards: 0,
    save: async () => {},
  };
});

async function invoke() {
  const replies = [];
  const jid = "wallet-test@g.us";
  globalThis.activeSpawns[jid] = { card, cardId: card.cardId, spawnId: "wallet-claim" };
  await claim.run({
    sender: "263771234567@s.whatsapp.net",
    msg: { key: { remoteJid: jid } },
    args: [getCardClaimId(card)],
    sock: { sendMessage: async (_jid, payload) => replies.push(payload) },
  });
  return replies;
}

test("claiming a spawned card debits its shown price from the WhatsApp wallet", async () => {
  const replies = await invoke();
  assert.equal(globalThis.cardClaimWallet, 380);
  assert.equal(globalThis.cardClaimProfile.cards.length, 1);
  assert.match(replies[0].text, /\$120/);
  assert.match(replies[0].text, /\$380/);
});

test("a spawned card cannot be claimed without enough wallet money", async () => {
  globalThis.cardClaimWallet = 100;
  const replies = await invoke();
  assert.equal(globalThis.cardClaimWallet, 100);
  assert.equal(globalThis.cardClaimProfile.cards.length, 0);
  assert.ok(globalThis.activeSpawns["wallet-test@g.us"]);
  assert.match(replies[0].text, /not enough money/i);
});
