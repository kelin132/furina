export default {
  name: "support",
  description: "Get bot support groups",
  category: "main",
  usage: ".support",
  aliases: ["group", "helpgroup"],
  cooldown: 5,
  isOwner: false,
  isAdmin: false,
  isPremium: false,
  version: "1.2.0",

  async run({ sock, msg }) {
    try {
      const supportMessage = `🌸 *AIDORU SUPPORT GC*

✨ Need help or want updates? Join our official community below!

🔗 https://chat.whatsapp.com/CfU4bt6JL0iGhXgjZfS9qt`;

      await sock.sendMessage(
        msg.key.remoteJid,
        {
          text: supportMessage,
          contextInfo: {
            externalAdReply: {
              title: "AKIRA-MD Support Hub",
              body: "Tap to join the community",
              mediaType: 1,
              previewType: 0,
              thumbnailUrl: "https://cdn.phototourl.com/member/2026-10-15-2d9bc601-85a4-47d1-9483-d0b34859e118.jpg",
              sourceUrl: "https://chat.whatsapp.com/CfU4bt6JL0iGhXgjZfS9qt",
              renderLargerThumbnail: true
            }
          }
        },
        { quoted: msg }
      );

    } catch (err) {
      console.error(err);

      await sock.sendMessage(
        msg.key.remoteJid,
        { text: "❌ Failed to send support link." },
        { quoted: msg }
      );
    }
  }
};
