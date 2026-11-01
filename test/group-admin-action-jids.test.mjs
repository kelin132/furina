import test from "node:test";
import assert from "node:assert/strict";
import promote from "../plugins/group/promote.js";
import demote from "../plugins/group/demote.js";
import { resolveGroupActionJids } from "../lib/groupIdentity.mjs";

test("promote and demote modules load with group-admin permissions", () => {
  assert.equal(promote.isAdmin, true);
  assert.equal(promote.isOwner, false);
  assert.equal(demote.isAdmin, true);
});

test("group actions resolve a LID to its phone JID and deduplicate targets", async () => {
  const sock = {
    groupMetadata: async () => ({
      participants: [{
        id: "276583713611808@lid",
        phoneNumber: "276583713611808@s.whatsapp.net",
      }],
    }),
  };
  const targets = await resolveGroupActionJids(
    sock,
    "group@g.us",
    ["276583713611808@lid", "276583713611808@s.whatsapp.net"],
  );
  assert.deepEqual(targets, ["276583713611808@s.whatsapp.net"]);
});
