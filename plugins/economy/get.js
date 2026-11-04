/**
 * .get <code>
 * Claim money using an owner-set code.
 *
 * Codes are created by the owner with .setget and stored in the
 * `get_codes` MongoDB collection. Each code has a set amount,
 * an expiry date, and an optional max-uses limit.
 * A user can only claim each code once.
 */

import { getUser, saveUser, checkLevelUp, requireRegistration, addHistory } from "./database.js";
import { getDb } from "../../lib/mongo.mjs";

const COLLECTION = "get_codes";

async function col() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

export default {
  name:        "get",
  description: "Claim money using an owner-issued code",
  category:    "economy",
  usage:       ".get <code>",
  aliases:     ["claimcode", "redeem"],
  cooldown:    5,

  async run({ sock, msg, sender, args }) {
    if (!await requireRegistration(sock, msg, sender)) return;

    const jid  = msg.key.remoteJid;
    const code = (args[0] || "").toUpperCase().trim();

    // ── No code provided ───────────────────────────────────────────────────
    if (!code) {
      return sock.sendMessage(jid, {
        text: "Usage: .get <code> to redeem an owner-issued code.",
      }, { quoted: msg });
    }

    // ── Look up the code ───────────────────────────────────────────────────
    const doc = await (await col()).findOne({ _id: code });

    if (!doc) {
      return sock.sendMessage(jid, {
        text: `❌ Code ${code} was not found.`,
      }, { quoted: msg });
    }

    const now = Date.now();

    // ── Check expiry ───────────────────────────────────────────────────────
    if (doc.expiry < now) {
      return sock.sendMessage(jid, {
        text: `❌ Code ${code} has expired.`,
      }, { quoted: msg });
    }

    // ── Check max uses ─────────────────────────────────────────────────────
    if (doc.maxUses !== null && doc.uses >= doc.maxUses) {
      return sock.sendMessage(jid, {
        text: `❌ Code ${code} has reached its claim limit.`,
      }, { quoted: msg });
    }

    // ── Check if already claimed ───────────────────────────────────────────
    if (doc.claimedBy?.includes(sender)) {
      return sock.sendMessage(jid, {
        text: `❌ You already claimed code ${code}.`,
      }, { quoted: msg });
    }

    // ── Atomically record the claim (prevents race conditions) ────────────
    const result = await (await col()).findOneAndUpdate(
      {
        _id: code,
        expiry: { $gt: now },
        $or: [
          { maxUses: null },
          { $expr: { $lt: ["$uses", "$maxUses"] } },
        ],
        claimedBy: { $ne: sender },
      },
      {
        $inc:  { uses: 1 },
        $push: { claimedBy: sender },
      },
      { returnDocument: "after" }
    );

    if (!result) {
      return sock.sendMessage(jid, {
        text: `❌ Code ${code} could not be claimed. It may have expired or reached its limit.`,
      }, { quoted: msg });
    }

    // ── Credit the user ────────────────────────────────────────────────────
    const user     = await getUser(sender);
    const amount   = doc.amount;
    user.money    += amount;
    user.xp        = (user.xp || 0) + 50;

    const { leveled, newLevel } = checkLevelUp(user);

    await saveUser(sender, user);
    await addHistory(sender, "get", amount, `Claimed code ${code}`);

    let text = `✅ Code ${code} claimed. $${amount.toLocaleString()} added to your wallet. Balance: $${user.money.toLocaleString()}.`;

    if (leveled) {
      text += ` Level up! You are now level ${user.level}.`;
    }

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
