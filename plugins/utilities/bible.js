const BIBLE_API = "https://bible-api.com/";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REFERENCE_LENGTH = 160;
const MAX_VERSE_TEXT_LENGTH = 8_000;

export default {
  name: "bible",
  description: "Look up a Bible verse or passage",
  category: "utilities",
  usage: ".bible <book chapter:verse>",
  aliases: [],
  cooldown: 3,

  async run({ sock, msg, text }) {
    const jid = msg.key.remoteJid;
    const reference = String(text || "").trim();
    if (!reference) {
      return sock.sendMessage(jid, {
        text: "Provide a Bible reference.\nExample: *.bible John 3:16*",
      }, { quoted: msg });
    }
    if (reference.length > MAX_REFERENCE_LENGTH) {
      return sock.sendMessage(jid, {
        text: "That reference is too long. Please provide a book and chapter/verse.",
      }, { quoted: msg });
    }

    try {
      const response = await fetch(`${BIBLE_API}${encodeURIComponent(reference)}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.text) {
        return sock.sendMessage(jid, {
          text: result?.error || "I couldn't find that Bible reference. Check the book, chapter, and verse.",
        }, { quoted: msg });
      }

      const verseText = String(result.text).trim().slice(0, MAX_VERSE_TEXT_LENGTH);
      return sock.sendMessage(jid, {
        text: `*THE BIBLE*\n\n_*Reference: ${result.reference || reference}*_\n${verseText}`,
      }, { quoted: msg });
    } catch (error) {
      console.error("[bible] lookup failed:", error);
      return sock.sendMessage(jid, {
        text: "The Bible lookup service is unavailable right now. Please try again later.",
      }, { quoted: msg });
    }
  },
};
