import { downloadQuotedMedia } from "../../lib/quotedMedia.mjs";
import { videoToMp3 } from "../../lib/mediaConvert.mjs";

export default {
  name: "tomp3",
  description: "Convert a replied-to video to MP3 audio",
  category: "utilities",
  usage: ".tomp3 (reply to a video)",
  aliases: ["toaudio"],
  cooldown: 5,

  async run({ sock, msg }) {
    const jid = msg.key.remoteJid;
    let media;
    try {
      media = await downloadQuotedMedia(msg, "video");
    } catch (error) {
      const text = error.code === "NOQUOTE"
        ? "Reply to a video with *.tomp3*."
        : error.code === "NOT_SUPPORTED_MEDIA"
          ? "The replied message isn't a video."
          : error.message || "I couldn't download that video.";
      return sock.sendMessage(jid, { text }, { quoted: msg });
    }

    try {
      const audio = await videoToMp3(media.buffer);
      return sock.sendMessage(jid, {
        audio,
        mimetype: "audio/mpeg",
        fileName: "audio.mp3",
        ptt: false,
      }, { quoted: msg });
    } catch (error) {
      console.error("[tomp3] conversion failed:", error);
      return sock.sendMessage(jid, {
        text: `Couldn't convert the video to audio: ${error.message || "conversion failed"}`,
      }, { quoted: msg });
    }
  },
};
