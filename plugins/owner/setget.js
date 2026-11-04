/**
 * .setget <code> <amount> <expiry_date> [maxUses]
 *   Create a claimable money code. Owner only.
 *
 * .deleteget <code>
 *   Remove a get-code. Owner only.
 *
 * .getinfo <code>
 *   View details of a get-code. Owner only.
 *
 * .listgets
 *   List all active get-codes. Owner only.
 *
 * Examples:
 *   .setget KELIN500 500000 2025-12-31
 *   .setget BONUS100 100000 2025-08-01 50     ← max 50 uses
 *   .deleteget KELIN500
 *   .getinfo KELIN500
 *   .listgets
 */

import { getDb } from "../../lib/mongo.mjs";

const COLLECTION = "get_codes";

async function col() {
  const db = await getDb();
  return db.collection(COLLECTION);
}

export default {
  name:        "setget",
  description: "Create / manage owner money-claim codes",
  category:    "owner",
  usage:       ".setget <code> <amount> <YYYY-MM-DD> [maxUses]",
  aliases:     ["deleteget", "getinfo", "listgets"],
  isOwner:     true,
  strictOwner: true,

  async run({ sock, msg, cmd, args, isActualOwner }) {
    const jid = msg.key.remoteJid;
    if (!isActualOwner) {
      return sock.sendMessage(jid, { text: "❌ Only the bot owner can manage claim codes." }, { quoted: msg });
    }

    // ── .listgets ──────────────────────────────────────────────────────────
    if (cmd === "listgets") {
      const codes = await (await col()).find({}).toArray();

      if (!codes.length) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 📋 𝑮𝑬𝑻 𝑪𝑶𝑫𝑬𝑺 📋 〕━━━╮
┃
┃ ✦ No active get-codes found.
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 📌 Create one with:
┃    .setget <code> <amount>
┃           <YYYY-MM-DD>
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 No codes yet — create one! 🌸`
        }, { quoted: msg });
      }

      const now   = Date.now();
      let   lines =
`╭━━━〔 📋 𝑮𝑬𝑻 𝑪𝑶𝑫𝑬𝑺 𝑳𝑰𝑺𝑻 📋 〕━━━╮\n┃\n`;

      for (const c of codes) {
        const expired = c.expiry < now;
        const status  = expired ? "⛔ EXPIRED" : "✅ ACTIVE";
        const expStr  = new Date(c.expiry).toDateString();
        const uses    = `${c.uses}/${c.maxUses ?? "∞"}`;

        lines +=
`┣━━━━━━━━━━━━━━━━━━━━
┃ 🔑 ${c._id}
┃ 💰 Amount  › $${Number(c.amount).toLocaleString()}
┃ 📅 Expires › ${expStr}
┃ 🔢 Claims  › ${uses}
┃ ${status}
┃\n`;
      }

      lines += `╰━━━━━━━━━━━━━━━━━━━━╯\n🌸✨ Total: ${codes.length} code(s) ✨🌸`;
      return sock.sendMessage(jid, { text: lines }, { quoted: msg });
    }

    // ── .getinfo <code> ────────────────────────────────────────────────────
    if (cmd === "getinfo") {
      const code = (args[0] || "").toUpperCase().trim();
      if (!code) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❓ 𝑮𝑬𝑻 𝑰𝑵𝑭𝑶 ❓ 〕━━━╮
┃
┃ ✦ Usage: .getinfo <code>
┃
┃ 📌 Example:
┃    .getinfo KELIN500
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Provide a code to inspect 🌸`
        }, { quoted: msg });
      }

      const doc = await (await col()).findOne({ _id: code });
      if (!doc) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑪𝑶𝑫𝑬 𝑵𝑶𝑻 𝑭𝑶𝑼𝑵𝑫 ❌ 〕━━━╮
┃
┃ ✦ Code not found in database.
┃
┃ 🔑 Code › ${code}
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Use .listgets to see all codes 🌸`
        }, { quoted: msg });
      }

      const now      = Date.now();
      const expired  = doc.expiry < now;
      const expStr   = new Date(doc.expiry).toDateString();
      const status   = expired ? "⛔ EXPIRED" : "✅ ACTIVE";
      const uses     = `${doc.uses}/${doc.maxUses ?? "∞"}`;

      const claimList = doc.claimedBy?.length
        ? doc.claimedBy.map(j => `+${j.split("@")[0].split(":")[0]}`).join(", ")
        : "None yet";

      return sock.sendMessage(jid, {
        text:
`╭━━━〔 🔑 𝑪𝑶𝑫𝑬 𝑰𝑵𝑭𝑶 🔑 〕━━━╮
┃
┃ ✦ Get-code details
┃
┃ 🔑 Code    ➜ 『 ${doc._id} 』
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 💰 Amount  › $${Number(doc.amount).toLocaleString()}
┃ 📅 Expires › ${expStr}
┃ 🔢 Claims  › ${uses}
┃ 📊 Status  › ${status}
┣━━━━━━━━━━━━━━━━━━━━
┃ 📜 Claimed by:
┃ ${claimList}
╰━━━━━━━━━━━━━━━━━━━━╯
🌸✨ Owner Dashboard ✨🌸`
      }, { quoted: msg });
    }

    // ── .deleteget <code> ──────────────────────────────────────────────────
    if (cmd === "deleteget") {
      const code = (args[0] || "").toUpperCase().trim();
      if (!code) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❓ 𝑫𝑬𝑳𝑬𝑻𝑬 𝑪𝑶𝑫𝑬 ❓ 〕━━━╮
┃
┃ ✦ Usage: .deleteget <code>
┃
┃ 📌 Example:
┃    .deleteget KELIN500
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Provide a code to delete 🌸`
        }, { quoted: msg });
      }

      const res = await (await col()).deleteOne({ _id: code });
      if (res.deletedCount === 0) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑵𝑶𝑻 𝑭𝑶𝑼𝑵𝑫 ❌ 〕━━━╮
┃
┃ ✦ Code not found in database.
┃
┃ 🔑 Code › ${code}
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Use .listgets to view all codes 🌸`
        }, { quoted: msg });
      }

      return sock.sendMessage(jid, {
        text:
`╭━━━〔 🗑️ 𝑪𝑶𝑫𝑬 𝑫𝑬𝑳𝑬𝑻𝑬𝑫 🗑️ 〕━━━╮
┃
┃ ✦ Code removed successfully!
┃
┃ 🔑 Code   ➜ 『 ${code} 』
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 🚫 Users can no longer
┃    claim this code.
╰━━━━━━━━━━━━━━━━━━━━╯
🌸✨ Code Deactivated ✨🌸`
      }, { quoted: msg });
    }

    // ── .setget <code> <amount> <YYYY-MM-DD> [maxUses] ────────────────────
    if (cmd === "setget") {
      if (args.length < 3) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❓ 𝑺𝑬𝑻 𝑮𝑬𝑻 𝑪𝑶𝑫𝑬 ❓ 〕━━━╮
┃
┃ ✦ Create a money claim code
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 📌 Usage:
┃    .setget <code> <amount>
┃            <YYYY-MM-DD> [maxUses]
┣━━━━━━━━━━━━━━━━━━━━
┃ 📌 Examples:
┃  .setget KELIN500 500000
┃          2025-12-31
┃
┃  .setget BONUS100 100000
┃          2025-08-01 50
┣━━━━━━━━━━━━━━━━━━━━
┃ 💡 Tips:
┃  • No spaces in the code
┃  • Max 20 characters
┃  • Omit maxUses = unlimited
╰━━━━━━━━━━━━━━━━━━━━╯
🌸✨ Owner Tool ✨🌸`
        }, { quoted: msg });
      }

      const code    = args[0].toUpperCase().trim().slice(0, 20);
      const amount  = parseInt(args[1], 10);
      const dateStr = args[2];
      const maxUses = args[3] ? parseInt(args[3], 10) : null;

      // Validate amount
      if (isNaN(amount) || amount <= 0) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑰𝑵𝑽𝑨𝑳𝑰𝑫 𝑨𝑴𝑶𝑼𝑵𝑻 ❌ 〕━━━╮
┃
┃ ✦ Amount must be a positive number.
┃
┃ 📌 Example:
┃    .setget KELIN500 500000
┃            2025-12-31
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Please check and try again 🌸`
        }, { quoted: msg });
      }

      // Validate date (YYYY-MM-DD)
      const expiry = Date.parse(dateStr);
      if (isNaN(expiry)) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑰𝑵𝑽𝑨𝑳𝑰𝑫 𝑫𝑨𝑻𝑬 ❌ 〕━━━╮
┃
┃ ✦ Use the format: YYYY-MM-DD
┃
┃ 📌 Example:
┃    .setget KELIN500 500000
┃            2025-12-31
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Please check and try again 🌸`
        }, { quoted: msg });
      }

      if (expiry <= Date.now()) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑫𝑨𝑻𝑬 𝑰𝑵 𝑷𝑨𝑺𝑻 ❌ 〕━━━╮
┃
┃ ✦ Expiry date must be in
┃   the future!
┃
┃ 📅 You entered › ${dateStr}
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Choose a future date 🌸`
        }, { quoted: msg });
      }

      // Validate maxUses if provided
      if (args[3] !== undefined && (isNaN(maxUses) || maxUses <= 0)) {
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ❌ 𝑰𝑵𝑽𝑨𝑳𝑰𝑫 𝑴𝑨𝑿 𝑼𝑺𝑬𝑺 ❌ 〕━━━╮
┃
┃ ✦ Max uses must be a positive
┃   integer, or omit for unlimited.
┃
┃ 📌 Example:
┃    .setget BONUS 100000
┃            2025-12-31 50
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Please check and try again 🌸`
        }, { quoted: msg });
      }

      // Check for duplicate
      const existing = await (await col()).findOne({ _id: code });
      if (existing) {
        const expStr = new Date(existing.expiry).toDateString();
        return sock.sendMessage(jid, {
          text:
`╭━━━〔 ⚠️ 𝑪𝑶𝑫𝑬 𝑬𝑿𝑰𝑺𝑻𝑺 ⚠️ 〕━━━╮
┃
┃ ✦ This code already exists!
┃
┃ 🔑 Code    ➜ 『 ${code} 』
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 💰 Amount  › $${Number(existing.amount).toLocaleString()}
┃ 📅 Expires › ${expStr}
┃ 🔢 Claims  › ${existing.uses}/${existing.maxUses ?? "∞"}
┣━━━━━━━━━━━━━━━━━━━━
┃ 💡 Use .deleteget ${code}
┃    first, then recreate it.
╰━━━━━━━━━━━━━━━━━━━━╯
🌸 Delete it first to replace 🌸`
        }, { quoted: msg });
      }

      // Save
      await (await col()).insertOne({
        _id:       code,
        amount,
        expiry,
        maxUses,
        uses:      0,
        claimedBy: [],
        createdAt: Date.now(),
        createdBy: "owner",
      });

      const expStr  = new Date(expiry).toDateString();
      const usesStr = maxUses ? `${maxUses} uses` : "Unlimited";

      return sock.sendMessage(jid, {
        text:
`╭━━━〔 ✅ 𝑪𝑶𝑫𝑬 𝑪𝑹𝑬𝑨𝑻𝑬𝑫 💰 〕━━━╮
┃
┃ ✦ New claim code is live!
┃
┃ 🔑 Code    ➜ 『 ${code} 』
┃
┣━━━━━━━━━━━━━━━━━━━━
┃ 💰 Amount  › $${amount.toLocaleString()}
┃ 📅 Expires › ${expStr}
┃ 🔢 Max Uses› ${usesStr}
┣━━━━━━━━━━━━━━━━━━━━
┃ 📢 Announce it with:
┃    .get ${code}
╰━━━━━━━━━━━━━━━━━━━━╯
🌸✨ Code Drop Ready ✨🌸`
      }, { quoted: msg });
    }
  },
};
