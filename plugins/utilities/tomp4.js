import { downloadQuotedMedia } from "../../lib/quotedMedia.mjs";
import { animatedWebpToMp4 } from "../../lib/mediaConvert.mjs";

export default {
  name: "tomp4",
  description: "Convert an animated sticker to MP4 video",
  category: "utilities",
  usage: ".tomp4 (reply to an animated sticker)",
  aliases: ["mp4"],
  cooldown: 5,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;
    let media;
    try {
      media = await downloadQuotedMedia(msg, "sticker");
    } catch (error) {
      const text = error.code === "NOQUOTE"
        ? "Reply to an animated sticker with *.tomp4*."
        : error.code === "NOT_SUPPORTED_MEDIA"
          ? "The replied message isn't a sticker."
          : error.message || "I couldn't download that sticker.";
      return sock.sendMessage(jid, { text }, { quoted: msg });
    }

    if (!media.media.isAnimated) {
      return sock.sendMessage(jid, {
        text: "Reply to an animated video sticker; still stickers can't be converted.",
      }, { quoted: msg });
    }

    try {
      const video = await animatedWebpToMp4(media.buffer);
      return sock.sendMessage(jid, {
        video,
        mimetype: "video/mp4",
        fileName: "sticker.mp4",
        gifPlayback: true,
      }, { quoted: msg });
    } catch (error) {
      console.error("[tomp4] conversion failed:", error);
      return sock.sendMessage(jid, {
        text: `Couldn't convert the sticker to video: ${error.message || "conversion failed"}`,
      }, { quoted: msg });
    }
  },
};
