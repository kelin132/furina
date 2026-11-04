export default {
  name: "leave",
  description: "Make the bot leave the current group",
  category: "group",
  usage: ".leave",
  aliases: ["bye", "leavegc"],
  cooldown: 5,
  isMod: true,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;

    if (!jid.endsWith("@g.us")) {
      return sock.sendMessage(
        jid,
        {
          text: "❌ This command can only be used in groups.",
        },
        { quoted: msg }
      );
    }

    try {
      await sock.sendMessage(
        jid,
        {
          text: "👋 Goodbye everyone!\n\nThanks for having me in this group.",
        },
        { quoted: msg }
      );

      await sock.groupLeave(jid);

    } catch (err) {
      console.error(err);

      await sock.sendMessage(
        jid,
        {
          text: `❌ Failed to leave the group.\n\n${err.message}`,
        },
        { quoted: msg }
      );
    }
  },
};