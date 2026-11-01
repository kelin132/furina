import test from "node:test";
import assert from "node:assert/strict";
import { decodeActivityJid, resolveActiveChatters } from "../plugins/group/active.js";

test("active decodes stored LID and phone IDs before mentioning members", () => {
  const storedLid = "jid_Mjc2NTgzNzEzNjExODA4QGxpZA";
  const storedPhone = "jid_MjM0OTE2ODgwODQ0MEBzLndoYXRzYXBwLm5ldA";
  assert.equal(decodeActivityJid(storedLid), "276583713611808@lid");
  assert.equal(decodeActivityJid(storedPhone), "2349168808440@s.whatsapp.net");

  const rows = resolveActiveChatters(
    [[storedLid, 22552], [storedPhone, 16501]],
    { participants: [
      { id: "276583713611808@lid", notify: "Kelin" },
      { id: "2349168808440@s.whatsapp.net", notify: "Mina" },
    ] },
  );
  assert.deepEqual(rows.map((row) => row.jid), [
    "276583713611808@lid",
    "2349168808440@s.whatsapp.net",
  ]);
  assert.match(rows[0].label, /Kelin/);
  assert.match(rows[1].label, /Mina/);
  assert.equal(rows[0].count, 22552);
});

test("active does not expose undecodable jid_ storage keys", () => {
  assert.equal(decodeActivityJid("jid_not-valid"), "");
});

test("active merges LID and phone activity for the same group member", () => {
  const storedLid = "jid_Mjc2NTgzNzEzNjExODA4QGxpZA";
  const storedPhone = "jid_Mjc2NTgzNzEzNjExODA4QHMud2hhdHNhcHAubmV0";
  const rows = resolveActiveChatters(
    [[storedLid, 12], [storedPhone, 8]],
    { participants: [{
      id: "276583713611808@lid",
      phoneNumber: "276583713611808@s.whatsapp.net",
      notify: "Kelin",
    }] },
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].jid, "276583713611808@s.whatsapp.net");
  assert.equal(rows[0].count, 20);
  assert.match(rows[0].label, /Kelin/);
});

test("active drops old activity records for people no longer in the group", () => {
  const storedLid = "jid_Mjc2NTgzNzEzNjExODA4QGxpZA";
  const rows = resolveActiveChatters(
    [[storedLid, 12]],
    { participants: [{ id: "2349168808440@s.whatsapp.net", notify: "Current member" }] },
  );
  assert.deepEqual(rows, []);
});
