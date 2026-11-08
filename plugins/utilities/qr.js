/**
 * KELIN MD — .qr command
 * Generates a QR code image for any text or URL.
 * Uses the free QR Server API (no key required).
 */

export default {
  name: "qr",
  description: "Generate a QR code for any text or URL",
  category: "utilities",
  usage: ".qr <text or URL>",
  aliases: ["qrcode", "qrgen"],
  cooldown: 10,
  isOwner: false,
  isAdmin: false,
  isPremium: false,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;

    if (!text) {
      return sock.sendMessage(jid, {
        text: "📷 *QR Code Generator*\n\nUsage: *.qr <text or URL>*\n\nExample: .qr https://example.com",
      }, { quoted: msg });
    }

    try {
      await sock.sendMessage(jid, { text: "⏳ Generating QR code..." }, { quoted: msg });

      // Build QR Server API URL — returns a PNG image directly
      const encoded = encodeURIComponent(text);
      const qrUrl   = `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=20&data=${encoded}`;

      // Fetch the image buffer
      const res = await fetch(qrUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`QR API error: HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());

      const preview = text.length > 60 ? text.slice(0, 57) + "..." : text;

      await sock.sendMessage(jid, {
        image:   buf,
        caption: `📷 *QR Code Generated*\n\n🔗 Content: ${preview}`,
      }, { quoted: msg });

    } catch (err) {
      console.error("[qr]", err.message);

      // Fallback: try alternate QR API
      try {
        const encoded2 = encodeURIComponent(text);
        const altUrl   = `https://quickchart.io/qr?text=${encoded2}&size=500&margin=3`;
        const res2     = await fetch(altUrl, { signal: AbortSignal.timeout(15_000) });
        if (!res2.ok) throw new Error(`Fallback QR API error: HTTP ${res2.status}`);
        const buf2 = Buffer.from(await res2.arrayBuffer());
        const preview = text.length > 60 ? text.slice(0, 57) + "..." : text;

        return sock.sendMessage(jid, {
          image:   buf2,
          caption: `📷 *QR Code Generated*\n\n🔗 Content: ${preview}`,
        }, { quoted: msg });
      } catch (err2) {
        console.error("[qr] fallback failed:", err2.message);
      }

      await sock.sendMessage(jid, {
        text: `❌ Failed to generate QR code.\n\n_${err.message}_`,
      }, { quoted: msg });
    }
  },
};
