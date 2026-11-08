// plugins/pokemon/pokespawn.js
// [Mod/Owner] Enable or disable automatic Pokémon spawning in this group

import { getDb } from "../../lib/mongo.mjs";

const COLLECTION = "pokemon_autospawn_chats";

async function setPokeSpawn(chatId, enabled) {
  const db = await getDb();
  await db.collection(COLLECTION).updateOne(
    { _id: chatId },
    { $set: { enabled } },
    { upsert: true }
  );
}

async function getPokeSpawn(chatId) {
  const db  = await getDb();
  const doc = await db.collection(COLLECTION).findOne({ _id: chatId });
  return doc?.enabled ?? false;
}

export default {
  name:        "pokespawn",
  aliases:     ["pokeautospawn", "wildautospawn"],
  description: "Turn automatic Pokémon spawns on or off in this group",
  category:    "pokemon",
  usage:       ".pokespawn on | off | status",
  isMod:       true,
  isAdmin:     true,
  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;
    const sub = (args[0] || "status").toLowerCase();

    if (sub === "on" || sub === "enable") {
      await setPokeSpawn(jid, true);
      return sock.sendMessage(jid, {
        text: "Pokémon auto-spawn is on. A wild Pokémon will appear every 15–20 minutes.",
      }, { quoted: msg });
    }

    if (sub === "off" || sub === "disable") {
      await setPokeSpawn(jid, false);
      return sock.sendMessage(jid, {
        text: "Pokémon auto-spawn is off.",
      }, { quoted: msg });
    }

    // status
    const enabled = await getPokeSpawn(jid);
    return sock.sendMessage(jid, {
      text:
`🌿 *Pokémon Auto-Spawn*

Status: ${enabled ? "On" : "Off"}
Interval: 15–20 minutes

*.pokespawn on* — enable
*.pokespawn off* — disable`,
    }, { quoted: msg });
  },
};
