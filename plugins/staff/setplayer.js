/**
 * .setplayer @user <field> <value>
 * Directly set a specific economy field on a player.
 * Fields: money, bank, crystals, xp, level
 */
import { setPlayerFields, getUser, isRegistered } from "../economy/database.js";

const FIELD_MAP = {
  money: "money",
  bank: "bank",
  crystals: "genesisCrystals",
  genesiscrystals: "genesisCrystals",
  diamonds: "genesisCrystals",
  xp: "xp",
  level: "level",
};

export default {
  name: "setplayer",
  description: "Set a specific economy field on a player",
  category: "staff",
  usage: ".setplayer @user <field> <value>",
  aliases: ["editplayer", "setstat"],
  isStaff: true,

  async run({ sock, msg, args }) {
    const jid = msg.key.remoteJid;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let targetJid = null;

    if (mentioned) {
      targetJid = mentioned;
    } else if (args[0]?.match(/^[0-9]+$/)) {
      targetJid = `${args[0]}@s.whatsapp.net`;
    }

    if (!targetJid) {
      return sock.sendMessage(jid, {
        text:
          `❓ *Usage:* \`.setplayer @user <field> <value>\`\n\n` +
          `*Allowed fields:*\n` +
          Object.keys(ALLOWED_FIELDS).map(f => `• \`${f}\``).join("\n")
      }, { quoted: msg });
    }

    // field and value are the last two args
    const field = args[args.length - 2]?.toLowerCase();
    const raw   = args[args.length - 1];

    const storedField = FIELD_MAP[field];
    if (!field || !storedField) {
      return sock.sendMessage(jid, {
        text: "❌ Invalid field. Allowed: money, bank, crystals, xp, level",
      }, { quoted: msg });
    }

    const value = parseFloat(raw);
    if (isNaN(value) || value < 0) {
      return sock.sendMessage(jid, { text: "❌ Value must be a non-negative number." }, { quoted: msg });
    }

    if (!await isRegistered(targetJid)) {
      return sock.sendMessage(jid, { text: "❌ That player is not registered." }, { quoted: msg });
    }

    const target = await getUser(targetJid);
    const oldVal = target[storedField] ?? 0;

    const updated = await setPlayerFields(targetJid, { [storedField]: value });
    if (!updated) {
      return sock.sendMessage(jid, {
        text: "❌ That player's registered account could not be updated. No data was changed.",
      }, { quoted: msg });
    }

    await sock.sendMessage(jid, {
      text:
        `✏️ *Player Updated*\n\n` +
        `👤 Player    : ${target.name}\n` +
        `📊 Field     : ${storedField === "genesisCrystals" ? "Genesis Crystals" : storedField}\n` +
        `🔢 Old Value : ${oldVal.toLocaleString()}\n` +
        `✅ New Value : ${value.toLocaleString()}`,
      mentions: [targetJid],
    }, { quoted: msg });
  }
};
