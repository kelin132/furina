/**
 * KELIN MD — .enablecat / .disablecat
 * Allow staff/mods to enable or disable entire command categories in a group.
 *
 * Usage:
 *   .enablecat              — list all categories and their status
 *   .enablecat <category|numbers...>   — enable one or more categories
 *   .disablecat <category|numbers...>  — disable one or more categories
 *
 * Protected categories (staff/owner always have access):
 *   main, staff, owner, group
 *
 * The actual enforcement happens in lib/pluginManager.mjs.
 */
import { groupSettings } from "../../lib/groupSettings.js";

// Categories that can never be disabled (essential bot functions)
const PROTECTED_CATS = new Set(["main", "staff", "owner", "group"]);

// All known categories — no circular import needed
const ALL_CATS = [
  "main", "economy", "company", "guild", "pets", "cards",
  "pokemon", "dragonball", "games", "fun", "ai",
  "search", "media", "image", "utilities", "download",
  "group", "anime", "staff", "owner",
];

export default {
  name: "enablecat",
  aliases: ["disablecat", "togglecat", "catcontrol"],
  description: "Enable or disable a command category in this group",
  category: "staff",
  usage: ".enablecat <category or number> | .disablecat <category or number>",
  isMod: true,
  cooldown: 3,

  async run({ sock, msg, args, cmd }) {
    const jid = msg.key.remoteJid;

    if (!jid.endsWith("@g.us")) {
      return sock.sendMessage(jid, {
        text: "❌ This command can only be used in groups.",
      }, { quoted: msg });
    }

    const settings = groupSettings.get(jid) || {};
    const disabled  = new Set(settings.disabledCategories || []);

    // ── No args: show status list ─────────────────────────────────────────
    if (!args.length) {
      const lines = ALL_CATS.map((cat, index) => {
        const isProtected = PROTECTED_CATS.has(cat);
        const isDisabled  = disabled.has(cat);
        const status = isProtected ? "protected" : isDisabled ? "disabled" : "enabled";
        return `${index + 1}. ${cat} — ${status}`;
      });

      return sock.sendMessage(jid, {
        text: `Category settings\n\n${lines.join("\n")}\n\n` +
          ".enablecat <category or number>\n" +
          ".disablecat <category or number>\n" +
          `Protected: ${[...PROTECTED_CATS].join(", ")}`,
      }, { quoted: msg });
    }

    const enable = cmd === "enablecat";
    const requested = args
      .flatMap(arg => arg.split(","))
      .map(value => value.trim().toLowerCase())
      .filter(Boolean);
    const targets = [...new Set(requested.map(value => {
      if (/^\d+$/.test(value)) {
        const index = Number(value) - 1;
        return ALL_CATS[index] || null;
      }
      return value;
    }))];
    const unknown = requested.filter(value => {
      if (/^\d+$/.test(value)) return !ALL_CATS[Number(value) - 1];
      return !ALL_CATS.includes(value);
    });
    const validTargets = targets.filter(Boolean).filter(target => ALL_CATS.includes(target));
    const protectedTargets = enable
      ? []
      : validTargets.filter(target => PROTECTED_CATS.has(target));
    const changedTargets = validTargets.filter(target => !protectedTargets.includes(target));

    if (!validTargets.length || !changedTargets.length) {
      return sock.sendMessage(jid, {
        text: [
          "No changes made.",
          unknown.length ? `Unknown categories/numbers: ${[...new Set(unknown)].join(", ")}` : "",
          protectedTargets.length
            ? `Protected categories cannot be disabled: ${protectedTargets.join(", ")}`
            : "",
          `Use *.${cmd}* to view the numbered category list.`,
        ].filter(Boolean).join("\n"),
      }, { quoted: msg });
    }

    // Apply all requested changes in one group-settings update.
    for (const target of changedTargets) {
      if (enable) {
        disabled.delete(target);
      } else {
        disabled.add(target);
      }
    }
    groupSettings.set(jid, { disabledCategories: [...disabled] });

    const changedText = changedTargets.join(", ");
    const notes = [
      `${enable ? "Enabled" : "Disabled"}: ${changedText}`,
      protectedTargets.length
        ? `Skipped protected: ${protectedTargets.join(", ")}`
        : "",
      unknown.length
        ? `Unknown: ${[...new Set(unknown)].join(", ")}`
        : "",
      enable ? "These commands are available." : "These commands are blocked for members.",
      !enable ? "Staff and owner can still use them." : "",
    ];

    await sock.sendMessage(jid, {
      text: notes.filter(Boolean).join("\n"),
    }, { quoted: msg });
  },
};
