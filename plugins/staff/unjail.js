/**
 * .unjail @user
 * Release a jailed player.
 */
import { unjailUser, getUser, isRegistered, addHistory } from "../economy/database.js";
import { resolveLidToJid } from "../../lib/identity.mjs";

export default {
  name: "unjail",
  description: "Release a player from jail",
  category: "staff",
  usage: ".unjail @user",
  aliases: ["freeplayer", "release"],
  isMod: true,

  async run({ sock, msg, args }) {
    const jid = msg.key.remoteJid;

    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
    let targetJid = null;

    if (mentioned) {
      targetJid = mentioned;
    } else if (args[0]?.match(/^[0-9]+$/)) {
      targetJid = `${args[0]}@s.whatsapp.net`;
    } else {
      return sock.sendMessage(jid, {
        text: "❓ *Usage:* `.unjail @user`"
      }, { quoted: msg });
    }
    targetJid = await resolveLidToJid(targetJid, sock, jid);

    if (!await isRegistered(targetJid)) {
      return sock.sendMessage(jid, { text: "❌ That player is not registered." }, { quoted: msg });
    }

    const target = await getUser(targetJid);

    if (!target.jailed) {
      return sock.sendMessage(jid, {
        text: `❌ *${target.name}* is not in jail.`
      }, { quoted: msg });
    }

    await unjailUser(targetJid);
    await addHistory(targetJid, "unjail", 0, `Released from jail`);

    await sock.sendMessage(jid, {
      text:
        `🔓 *Player Released*\n\n` +
        `👤 Player : ${target.name}\n` +
        `✅ Status  : Free — bot commands restored.`,
      mentions: [targetJid],
    }, { quoted: msg });
  }
};
