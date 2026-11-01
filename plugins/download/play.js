/**
 * KELIN MD — .play command
 * Searches YouTube and downloads audio.
 * Tries multiple API endpoints with automatic fallback.
 */
import yts from "yt-search";
import { get, davidGet } from "../../lib/gifted.js";
import { downloadMediaBuffer, omegaDownload } from "../../lib/omegaDownload.js";
import { princeMedia, PRINCE_ENDPOINTS } from "../../lib/princeTech.mjs";
import { kordGet, pickKordMedia, pickKordTitle } from "../../lib/kordApi.mjs";
import { knightbotGet, pickKnightMedia, pickKnightTitle } from "../../lib/knightbotApi.mjs";
import { requireAudioPayload } from "../../lib/audioPayload.mjs";
import { isSoundCloudTrackUrl, soundcloudDownloadUrl, soundcloudTrackTitle } from "../../lib/soundcloudDownload.mjs";

// ── YouTube search ────────────────────────────────────────────────────────────

async function ytSearch(input) {
  if (isSoundCloudTrackUrl(input)) {
    return { url: input, title: soundcloudTrackTitle(input), thumbnail: null, duration: "", author: "", views: "" };
  }
  if (/youtube\.com|youtu\.be/i.test(input)) {
    return { url: input, title: input, thumbnail: null, duration: "", author: "", views: "" };
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
    views:     v.views ? Number(v.views).toLocaleString() : "",
  };
}

// ── Extract a download link from any API response shape ──────────────────────

function pickAudio(result) {
  if (typeof result === "string" && /^https?:\/\//i.test(result)) return result;
  if (!result) return null;
  const keys = [
    "download_url", "downloadUrl", "download", "dl_url", "dl", "audio_url", "audioUrl",
    "audio", "mp3", "media_url", "mediaUrl", "url", "link",
  ];
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "string" && /^https?:\/\//i.test(value)) return value;
  }
  for (const child of [result.result, result.data, result.media, result.download]) {
    const nested = pickAudio(child);
    if (nested) return nested;
  }
  return null;
}

// ── Send the track thumbnail / banner ─────────────────────────────────────────

async function sendBanner(sock, jid, msg, meta, action) {
  const caption = [
    `🎵 *${meta.title}*`,
    meta.author   ? `👤 ${meta.author}`       : "",
    meta.duration ? `⏱️ ${meta.duration}`     : "",
    meta.views    ? `👁️ ${meta.views} views`  : "",
    "",
    `⬇️ _${action}_`,
  ].filter(Boolean).join("\n");

  if (meta.thumbnail) {
    try {
      return await sock.sendMessage(jid, { image: { url: meta.thumbnail }, caption }, { quoted: msg });
    } catch { /* fall through to text */ }
  }
  return sock.sendMessage(jid, { text: caption }, { quoted: msg });
}

// ── Valore AIO fallback ─────────────────────────────────────────────────────────

async function valoreAudio(videoUrl) {
  const response = await fetch("https://dl.valore.web.id/api/download", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Session-Id": `kelin-play-${Date.now()}`,
      Accept: "application/json",
    },
    body: JSON.stringify({ url: videoUrl }),
    signal: AbortSignal.timeout(45_000),
  });

  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(`Valore returned a non-JSON response (HTTP ${response.status})`);
  }

  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || payload?.error || `Valore request failed (HTTP ${response.status})`);
  }

  const medias = Array.isArray(payload?.data?.medias) ? payload.data.medias : [];
  const audio = medias
    .filter((media) => media?.audioAvailable !== false && /^audio$/i.test(String(media.type || "")) && /mp3|m4a|audio/i.test(String(media.format || "")) && /^https?:\/\//i.test(media.url || ""))
    .sort((a, b) => Number(b.size || 0) - Number(a.size || 0))[0];

  if (!audio) throw new Error("Valore returned no usable MP3 stream");
  return { dl: audio.url, title: payload?.data?.title || "YouTube Audio" };
}

// ── Try downloading via multiple endpoints ────────────────────────────────────

export async function fetchAudio(videoUrl, searchTitle = "") {
  const officialSoundCloudUrl = soundcloudDownloadUrl(videoUrl);
  if (officialSoundCloudUrl) {
    // Never pass SoundCloud URLs to general providers: they may stream tracks
    // even when the creator has disabled the official download option.
    const file = await downloadMediaBuffer(officialSoundCloudUrl, { timeoutMs: 45_000 });
    const format = requireAudioPayload(file.buffer);
    return {
      buffer: file.buffer,
      mimetype: format.mime,
      extension: format.extension,
      title: searchTitle || soundcloudTrackTitle(videoUrl),
    };
  }

  const endpoints = [
    async () => { const data = await knightbotGet("download", { type: "mp3", url: videoUrl }); const dl = pickKnightMedia(data, videoUrl); if (!dl) throw new Error("KnightBot returned no audio link"); return { dl, title: pickKnightTitle(data, "YouTube Audio") }; },
    async () => {
      const data = await kordGet("yt-song", videoUrl);
      const dl = pickKordMedia(data, "audio");
      if (!dl) throw new Error("Kord returned no YouTube audio link");
      return { dl, title: pickKordTitle(data, "YouTube Audio") };
    },
    // Gifted API — primary endpoints
    () => get("/download/ytmp3",   { url: videoUrl }),
    () => get("/download/ytaudio", { url: videoUrl }),
    () => get("/download/youtube", { url: videoUrl, type: "audio" }),
    // David Cyril API — fallback
    () => davidGet("/download/ytmp3",   { url: videoUrl }),
    () => davidGet("/download/ytaudio", { url: videoUrl }),
    // OmegaTech documented fallback. Its `/play` route expects a search
    // query, not a YouTube URL; use the resolved title first and retain the
    // URL as a secondary attempt for providers that accept URLs.
    () => omegaDownload("play", { query: searchTitle || videoUrl, format: "mp3", quality: "128k" }),
    () => omegaDownload("play", { query: videoUrl, format: "mp3", quality: "128k" }),
    // Exact Prince Tech MP3 endpoint supplied for `.play`.
    // It is tried before other emergency sources and is accepted only when it
    // returns a real URL or direct audio buffer; quality-only metadata is not media.
    async () => {
      const result = await princeMedia(PRINCE_ENDPOINTS.play, { url: videoUrl, format: "mp3" });
      return result.buffer
        ? { buffer: result.buffer, mimetype: result.mimetype, title: "" }
        : { dl: result.url, title: "" };
    },
    // Valore AIO fallback; select a real MP3 stream from its media list.
    () => valoreAudio(videoUrl),
  ];

  let lastError;
  for (const attempt of endpoints) {
    try {
      const data = await attempt();
      if (data?.buffer) {
        try {
          const format = requireAudioPayload(data.buffer);
          return { ...data, mimetype: format.mime, extension: format.extension };
        } catch (error) {
          lastError = error;
          continue;
        }
      }
      const result = data?.result || data?.data || data;
      const dl = data?.dl || pickAudio(data) || pickAudio(result);
      if (!dl) {
        lastError = new Error("Provider returned no audio URL");
        continue;
      }
      try {
        const file = await downloadMediaBuffer(dl);
        const format = requireAudioPayload(file.buffer);
        return { buffer: file.buffer, mimetype: format.mime, extension: format.extension, title: result?.title || data?.title || "" };
      } catch (mediaError) {
        lastError = mediaError;
      }
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(`All audio download sources failed. ${lastError?.message || "No provider returned usable audio."}`);
}

// ── .play ─────────────────────────────────────────────────────────────────────

export default {
  name: "play",
  description: "Search YouTube or download an officially downloadable SoundCloud track",
  category: "download",
  usage: ".play <song name, YouTube URL, or SoundCloud track URL>",
  aliases: ["song", "music", "mp3", "ytmp3"],
  cooldown: 15,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;

    if (!text) {
      return sock.sendMessage(jid, {
        text: "🎵 Usage: *.play <song name or YouTube URL>*\n\nExample: .play Shape of You"
      }, { quoted: msg });
    }

    try {
      const meta = await ytSearch(text);
      await sendBanner(sock, jid, msg, meta, "Fetching audio… please wait");

      const { buffer, mimetype, extension, title } = await fetchAudio(meta.url, meta.title);
      const trackTitle = title || meta.title;
      const format = requireAudioPayload(buffer);

      const safeTitle = String(trackTitle || "audio")
        .replace(/[\\/:*?"<>|]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80) || "audio";
      await sock.sendMessage(jid, {
        audio: buffer,
        mimetype,
        fileName: `${safeTitle}.${extension || format.extension}`,
        ptt: false,
      }, { quoted: msg });

    } catch (err) {
      console.error("[play]", err.message);
      const soundcloudInput = isSoundCloudTrackUrl(text);
      await sock.sendMessage(jid, {
        text: soundcloudInput
          ? "❌ SoundCloud's official download is unavailable for this track. The creator may have downloads disabled."
          : "❌ This audio couldn't be downloaded. Try again later!"
      }, { quoted: msg });
    }
  },
};
