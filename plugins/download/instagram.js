/**
 * KELIN MD — .instagram command
 * Downloads Instagram posts, reels, and videos via yt-dlp (auto-downloaded).
 */

import { downloadMediaBuffer } from '../../lib/omegaDownload.js';
import { kordGet, pickKordMedia, pickKordTitle } from '../../lib/kordApi.mjs';
import { knightbotGet, pickKnightMedia, pickKnightTitle } from "../../lib/knightbotApi.mjs";

// ── Dedup ─────────────────────────────────────────────────────────────────────
const processedMessages = new Set();

function isValidInstagramUrl(url) {
  return /(?:instagram\.com|instagr\.am)/i.test(url);
}

// ── Plugin ────────────────────────────────────────────────────────────────────
export default {
  name: 'instagram',
  description: 'Download Instagram posts, reels, and videos',
  category: 'download',
  usage: '.instagram <Instagram URL>',
  aliases: ['ig', 'igdl', 'reels', 'insta', 'reel'],
  cooldown: 30,

  async run({ sock, msg, args, text }) {
    const jid = msg.key.remoteJid;

    // Dedup
    if (processedMessages.has(msg.key.id)) return;
    processedMessages.add(msg.key.id);
    setTimeout(() => processedMessages.delete(msg.key.id), 5 * 60 * 1000);

    // Extract URL
    const raw   = text || args.join(' ');
    const match = raw.match(/https?:\/\/\S+/);
    const url   = match?.[0]?.replace(/[<>]/g, '');

    if (!url || !isValidInstagramUrl(url)) {
      return sock.sendMessage(jid, {
        text:
          '📸 *Instagram Downloader*\n\n' +
          'Usage: *.instagram <URL>*\n\n' +
          'Supported:\n' +
          '• Posts:   instagram.com/p/…\n' +
          '• Reels:   instagram.com/reel/…\n' +
          '• TV:      instagram.com/tv/…\n' +
          '• Stories: instagram.com/stories/…',
      }, { quoted: msg });
    }

    try {
      await sock.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
      await sock.sendMessage(jid, { text: '⏳ Downloading Instagram media…' }, { quoted: msg });

      let data;
      let mediaUrl;
      let title;
      try { data = await knightbotGet("download/instagram", { url: url.trim() }); mediaUrl = pickKnightMedia(data, url.trim()); title = pickKnightTitle(data, "Instagram Post"); } catch { /* fall back to Kord */ }
      if (!mediaUrl) { data = await kordGet("insta", url.trim()); mediaUrl = pickKordMedia(data, "auto"); title = pickKordTitle(data, "Instagram Post"); }
      if (!mediaUrl) throw new Error("No Instagram media link returned");
      const file = await downloadMediaBuffer(mediaUrl);
      title = String(title || "Instagram Post").slice(0, 200);
      const caption = `📥 *${title}*`;
      const mimetype = String(file.mimetype || '').toLowerCase();

      if (mimetype.startsWith('video/') || /reel|tv/i.test(url)) {
        await sock.sendMessage(jid, {
          video: file.buffer,
          mimetype: mimetype.startsWith('video/') ? mimetype : 'video/mp4',
          caption,
        }, { quoted: msg });
      } else {
        await sock.sendMessage(jid, { image: file.buffer, caption }, { quoted: msg });
      }

      await sock.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (err) {
      console.error('[instagram]', err.message);
      await sock.sendMessage(jid, { react: { text: '❌', key: msg.key } });
      await sock.sendMessage(jid, {
        text:
          `❌ *Instagram download failed.*\n\n` +
          `_${err.message.slice(0, 300)}_\n\n` +
          `💡 Make sure the post is public and the URL is correct.`,
      }, { quoted: msg });
    }
  },
};
