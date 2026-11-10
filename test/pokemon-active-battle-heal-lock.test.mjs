import assert from "node:assert/strict";
import test from "node:test";
import {
  endBattle,
  getBattleForTrainer,
  startWildBattle,
} from "../lib/pokemon/battleState.mjs";
import { isLiveWebBattleForTrainer } from "../lib/pokemon/activeBattle.mjs";

test("chat battle lookup finds a trainer across groups and normalizes device JIDs", () => {
  const battle = startWildBattle(
    "another-group@g.us",
    { jid: "27628114340:4@s.whatsapp.net", username: "trainer", pokemon: { hp: 10 } },
    { name: "Wild Pokémon", hp: 10 },
  );

  assert.equal(getBattleForTrainer(["27628114340@s.whatsapp.net"]), battle);
  endBattle("another-group@g.us");
  assert.equal(getBattleForTrainer(["27628114340@s.whatsapp.net"]), null);
});

test("a live website battle blocks healing for either participant", () => {
  const now = Date.now();
  const room = {
    status: "active",
    challenger: { id: "27628114340@s.whatsapp.net" },
    opponent: { id: "discord:12345" },
    createdAt: new Date(now - 1_000),
    lastActionAt: new Date(now - 1_000),
    expiresAt: new Date(now + 60_000),
  };

  assert.equal(isLiveWebBattleForTrainer(room, ["27628114340@s.whatsapp.net"], now), true);
  assert.equal(isLiveWebBattleForTrainer(room, ["discord:12345"], now), true);
  assert.equal(isLiveWebBattleForTrainer(room, ["other@s.whatsapp.net"], now), false);
});

test("waiting, finished, expired, and stale website rooms do not block healing", () => {
  const now = Date.now();
  const base = {
    challenger: { id: "trainer@s.whatsapp.net" },
    opponent: null,
    createdAt: new Date(now - 1_000),
    lastActionAt: new Date(now - 1_000),
    expiresAt: new Date(now + 60_000),
  };

  assert.equal(isLiveWebBattleForTrainer({ ...base, status: "waiting" }, ["trainer@s.whatsapp.net"], now), false);
  assert.equal(isLiveWebBattleForTrainer({ ...base, status: "finished" }, ["trainer@s.whatsapp.net"], now), false);
  assert.equal(isLiveWebBattleForTrainer({ ...base, status: "active", expiresAt: new Date(now - 1) }, ["trainer@s.whatsapp.net"], now), false);
  assert.equal(isLiveWebBattleForTrainer({ ...base, status: "active", lastActionAt: new Date(now - 121_000) }, ["trainer@s.whatsapp.net"], now), false);
});
