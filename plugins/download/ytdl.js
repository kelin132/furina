/**
 * KELIN MD — .ytdl command
 * Downloads YouTube videos using GiftedTech API with David Cyril fallback.
 */
import yts from "yt-search";
import { get, davidGet } from "../../lib/gifted.js";
import { downloadMediaBuffer, omegaDownload } from "../../lib/omegaDownload.js";
import { princeMedia, PRINCE_ENDPOINTS } from "../../lib/princeTech.mjs";
import { kordGet, pickKordMedia, pickKordTitle, pickKordYouTubeVideo } from "../../lib/kordApi.mjs";
import { knightbotGet, pickKnightMedia, pickKnightTitle } from "../../lib/knightbotApi.mjs";

// ── Search YouTube ────────────────────────────────────────────────────────────

async function ytSearch(input) {
  if (/youtube\.com|youtu\.be/i.test(input)) {
    return { url: input, title: input, thumbnail: null, duration: "", author: "" };
  }
  const { videos } = await yts(input);
  if (!videos?.length) throw new Error("No results found for: " + input);
  const v = videos[0];
  return {
    url:       v.url,
    title:     v.title,
    thumbnail: v.thumbnail || v.image || null,
    duration:  v.timestamp || "",
    author:    v.author?.name || "",
  };
}

// ── Extract video download URL ────────────────────────────────────────────────

function pickVideo(result) {
  if (!result) return null;
  return (
    result.dl ||
    result.download ||
    result.dl_url ||
    result.download_url ||
    result.video_url    ||
    result.video        ||
    result.hd           ||
    result.sd           ||
    result.url          ||
    result.link         ||
    null
  );
}

async function fetchVideo(videoUrl) {
  const endpoints = [
    async () => { const data = await knightbotGet("download/ytmp4", { format: "480p", url: videoUrl }); const dl = pickKnightMedia(data, videoUrl); if (!dl) throw new Error("KnightBot returned no YouTube video link"); return { dl, title: pickKnightTitle(data) }; },
    async () => {
      const data = await kordGet("ytdl", videoUrl, { timeoutMs: 12_000 });
      const dl = pickKordYouTubeVideo(data) || pickKordMedia(data, "video");
      if (!dl) throw new Error("Kord returned no YouTube video link");
      return { dl, title: pickKordTitle(data) };
    },
    // OmegaTech all-downloader
    () => omegaDownload("all", { url: videoUrl }, { timeoutMs: 12_000 }),
    () => get("/download/ytdl",    { url: videoUrl }, 8_000),
    () => get("/download/youtube", { url: videoUrl, type: "video" }, 8_000),
    () => get("/download/yt",      { url: videoUrl }, 8_000),
    () => davidGet("/download/ytdl",    { url: videoUrl }, 8_000),
    () => davidGet("/download/youtube", { url: videoUrl, type: "video" }, 8_000),
    () => davidGet("/download/yt",      { url: videoUrl }, 8_000),
    // Prince Tech fallbacks, tried last so existing providers remain preferred.
    () => princeMedia(PRINCE_ENDPOINTS.yt, { url: videoUrl }, { timeoutMs: 8_000 }),
    () => princeMedia(PRINCE_ENDPOINTS.ytVideo, { format: "360p", url: videoUrl }, { timeoutMs: 8_000 }),
  ];

  let lastError;
  for (const attempt of endpoints) {
    try {
      const data = await attempt();
      if (data?.buffer) {
        const mimetype = String(data.mimetype || "").toLowerCase();
        if (mimetype && !mimetype.startsWith("video/")) throw new Error("Provider returned non-video media");
        return { ...data, mimetype: mimetype || "video/mp4" };
      }
      const result = data?.result || data?.data || data;
      const dl = data?.url || data?.dl || pickVideo(result);
      if (!dl || !/^https?:\/\//i.test(dl)) throw new Error("Provider returned no valid video URL");
      const file = await downloadMediaBuffer(dl, { timeoutMs: 20_000 });
      if (file.mimetype && !file.mimetype.startsWith("video/") && !/\.(mp4|webm|mov)(?:\?|$)/i.test(dl)) {
        throw new Error("Provider returned non-video media");
      }
      return { buffer: file.buffer, mimetype: file.mimetype || "video/mp4", title: result?.title || data?.title || "" };
    } catch (error) {
      lastError = error;
      console.error("[ytdl provider]", error?.message || error);
    }
  }

  throw new Error(`No usable video source returned${lastError?.message ? `: ${lastError.message}` : ""}`);
}

// ── .ytdl ─────────────────────────────────────────────────────────────────────

export default {
  name: "yt",
  description: "Download YouTube videos (MP4)",
  category: "download",
  usage: ".ytdl <YouTube URL or search query>",
  aliases: ["yt", "youtube", "video"],
  cooldown: 30,
  isOwner: false,
  isAdmin: false,
  isPremium: false,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;

    if (!text) {
      return sock.sendMessage(jid, {
        text: "🎬 *YouTube Video Downloader*\n\nUsage:\n*.ytdl <YouTube URL or search query>*\n\nExample:\n.ytdl https://youtu.be/xxxxx\n.ytdl Naruto opening 1\n\n💡 For audio only, use *.play*",
      }, { quoted: msg });
    }

    try {
      await sock.sendMessage(jid, { text: "🔍 Searching YouTube..." }, { quoted: msg });

      const meta = await ytSearch(text);

      // Send preview while fetching
      const previewCaption = [
        `🎬 *${meta.title}*`,
        meta.author   ? `👤 ${meta.author}`   : "",
        meta.duration ? `⏱️ ${meta.duration}` : "",
        "",
        "⬇️ _Downloading video… please wait_",
      ].filter(Boolean).join("\n");

      if (meta.thumbnail) {
        try {
          await sock.sendMessage(jid, {
            image:   { url: meta.thumbnail },
            caption: previewCaption,
          }, { quoted: msg });
        } catch {
          await sock.sendMessage(jid, { text: previewCaption }, { quoted: msg });
        }
      } else {
        await sock.sendMessage(jid, { text: previewCaption }, { quoted: msg });
      }

      const { buffer, mimetype: returnedMimetype, title } = await fetchVideo(meta.url);
      const file = { buffer, mimetype: returnedMimetype || "video/mp4" };
      const trackTitle = title || meta.title;
      const mimetype = file.mimetype.startsWith("video/") ? file.mimetype : "video/mp4";

      await sock.sendMessage(jid, {
        video: file.buffer,
        mimetype,
        fileName: `${trackTitle}.mp4`,
        caption: `🎬 *${trackTitle}*`,
      }, { quoted: msg });

    } catch (err) {
      console.error("[ytdl]", err.message);
      await sock.sendMessage(jid, {
        text: "❌ This video couldn't be downloaded. Try again later!",
      }, { quoted: msg });
    }
  },
};
