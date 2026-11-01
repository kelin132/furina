import { getGroupMetadata, groupRoles } from "../../lib/groupIdentity.mjs";
import { downloadQuotedMedia } from "../../lib/quotedMedia.mjs";

export default {
  name: "gpp",
  description: "Set or remove the group profile picture",
  category: "group",
  usage: ".gpp (reply to an image) | .gpp remove",
  aliases: ["setgcpp"],
  cooldown: 5,
  isAdmin: true,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;
    if (!jid?.endsWith("@g.us")) {
      return sock.sendMessage(jid, {
        text: "This command can only be used in groups.",
      }, { quoted: msg });
    }

    try {
      const metadata = await getGroupMetadata(sock, jid);
      const roles = await groupRoles(
        sock,
        metadata,
        msg.key.participant || msg.key.remoteJid,
        msg.key.participantAlt || msg.key.remoteJidAlt || "",
      );
      if (!roles.botIsAdmin) {
        return sock.sendMessage(jid, { text: "The bot must be a group admin first." }, { quoted: msg });
      }

      if (String(text || "").trim().toLowerCase() === "remove") {
        await sock.removeProfilePicture(jid);
        return sock.sendMessage(jid, {
          text: "✓ Group profile picture removed.",
        }, { quoted: msg });
      }

      let image;
      try {
        image = await downloadQuotedMedia(msg, "image");
      } catch (error) {
        const message = error.code === "NOQUOTE"
          ? "Reply to an image with *.gpp* to set it as the group picture, or use *.gpp remove*."
          : error.code === "NOT_SUPPORTED_MEDIA"
            ? "Reply to an image to set the group picture."
            : error.message || "I couldn't download that image.";
        return sock.sendMessage(jid, { text: message }, { quoted: msg });
      }

      await sock.updateProfilePicture(jid, image.buffer);
      return sock.sendMessage(jid, {
        text: "✓ Group profile picture updated.",
      }, { quoted: msg });
    } catch (error) {
      console.error("[gpp] group picture update failed:", error);
      return sock.sendMessage(jid, {
        text: "Couldn't update the group picture. Check the bot's admin permission and try again.",
      }, { quoted: msg });
    }
  },
};
