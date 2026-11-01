import { getPlugins } from "../../lib/pluginManager.mjs";
import { groupSettings } from "../../lib/groupSettings.js";
import { getRuntimeSettings } from "../../lib/runtimeSettings.mjs";

const READMORE = "\u200B".repeat(4000);

const categoryEmojis = {
  main: "🏡", economy: "💰", guild: "⚔️", dragonball: "🐉",
  pokemon: "🔴", ptcg: "🎴", cards: "🃏", pets: "🐾", anime: "🍡", staff: "🛡️",
  company: "🏢", games: "🎲", fun: "🎀", ai: "🪄", search: "🔎",
  image: "🎨", utilities: "🔧", download: "📥", group: "🌸", admin: "⚜️",
  owner: "👑", rpg: "🛡️", tools: "⚒️", weapons: "⚔️", armor: "🛡️",
  potions: "🧪", consumables: "🍱", scrolls: "📜", cosmetics: "💍",
  exchange: "⚖️", gacha: "💎", bases: "🏠",
};

const categoryTitles = {
  main: "MAIN", economy: "ECONOMY", guild: "GUILD", pets: "PETS",
  cards: "CARDS", ptcg: "POKÉMON TCG POCKET", pokemon: "POKEMON", dragonball: "DRAGON BALL",
  rpg: "RPG ADVENTURE", games: "GAMES", fun: "FUN", ai: "AI",
  search: "SEARCH", image: "IMAGE", utilities: "UTILITIES",
  download: "DOWNLOAD", group: "GROUP", anime: "ANIME",
  staff: "STAFF", owner: "OWNER", company: "COMPANY",
  media: "MEDIA", admin: "ADMIN",
  tools: "TOOLS", weapons: "WEAPONS", armor: "ARMOR",
  potions: "POTIONS", consumables: "CONSUMABLES", scrolls: "SCROLLS",
  cosmetics: "COSMETICS", exchange: "EXCHANGE", gacha: "GACHA",
  bases: "BASES",
};

function normalizeCategory(value = "") {
  const normalized = String(value).trim().toLowerCase().replace(/é/g, "e");
  if (normalized === "poke") return "pokemon";
  if (normalized === "dbz") return "dragonball";
  if (normalized === "dragon ball") return "dragonball";
  return normalized;
}

function formatUsage(usage, menuPrefix) {
  if (!usage) return "";
  return String(usage).replace(/\.(?=[a-z])/gi, menuPrefix);
}

function renderDetailedCommand(plugin, menuPrefix) {
  const command = `${menuPrefix}${plugin.name}`;
  const aliases = (plugin.aliases || [])
    .filter((alias) => alias && alias !== plugin.name)
    .map((alias) => `${menuPrefix}${alias}`);
  const aliasLine = aliases.length ? `\n│   ◇ Also: ${aliases.join("  ·  ")}` : "";
  const usage = formatUsage(plugin.usage, menuPrefix);
  const usageLine = usage ? `\n│   ↳ ${usage}` : "";
  const description = plugin.description || "Explore this command in your trainer journey.";

  return `│ ✦ *${command}*${aliasLine}\n│   ${description}${usageLine}`;
}

function renderCategory(emoji, title, disabledTag, plugins, menuPrefix, detailed = false) {
  const commandLines = plugins
    .map((plugin) => detailed
      ? renderDetailedCommand(plugin, menuPrefix)
      : `│ ꕥ *${menuPrefix}${plugin.name}*`)
    .join("\n");

  const heading = disabledTag ? `*${title}*${disabledTag}` : `*${title}*`;
  return `\n╭─${emoji} 「 ${heading} 」\n│\n${commandLines}\n╰━━━━━━━━━━━━━━━━━━━━`;
}

export default {
  name: "menu",
  description: "Display all available commands",
  category: "main",
  usage: ".menu [category]  — e.g. .menu pokemon",
  aliases: ["help", "cmds", "commands", "start"],
  cooldown: 10,

  async run({ sock, msg, prefix, isOwner, isStaff, isMod, sender, args }) {
    const jid = msg.key.remoteJid;
    const allPlugins = getPlugins();
    const isGroup = jid?.endsWith("@g.us");
    const senderNum = sender.split("@")[0].split(":")[0];
    const mention = `@${senderNum}`;
    const gs = isGroup ? (groupSettings.get(jid) || {}) : {};
    const disabledCats = new Set(gs.disabledCategories || []);
    const runtime = getRuntimeSettings();
    const menuPrefix = runtime.prefix || prefix;
    const requestedCategory = normalizeCategory(args?.[0] || "");

    const map = new Map();
    for (const plugin of allPlugins) {
      if (plugin.hidden) continue;
      let cat = plugin.category || "other";
      cat = normalizeCategory(cat);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat).push(plugin);
    }

    const showStaff = isOwner || isStaff || isMod;
    const order = [
      "main", "economy", "company", "guild", "pets", "cards", "ptcg",
      "pokemon", "dragonball", "dbz", "rpg", "games", "fun", "ai", "search", "media",
      "image", "utilities", "download", "group", "admin", "anime",
      "tools", "weapons", "armor", "potions", "consumables", "scrolls",
      "cosmetics", "exchange", "gacha", "bases",
    ];

    const sortedCats = [
      ...order.filter((cat) => map.has(cat)),
      ...[...map.keys()].filter((cat) => !order.includes(cat) && cat !== "staff" && cat !== "owner").sort(),
      ...(showStaff && map.has("staff") ? ["staff"] : []),
      ...(showStaff && map.has("owner") ? ["owner"] : []),
    ];

    if (requestedCategory && !sortedCats.includes(requestedCategory)) {
      // Check if it's a hidden staff category requested by non-staff
      if (["staff", "owner"].includes(requestedCategory) && !showStaff) {
         return sock.sendMessage(jid, { text: "❌ Access denied." }, { quoted: msg });
      }
      return sock.sendMessage(jid, {
        text: `❌ That category is unavailable here.\n\nTry *.menu pokemon* to open the Pokémon command guide.`,
      }, { quoted: msg });
    }

    const visibleCats = requestedCategory ? [requestedCategory] : sortedCats;
    let text = requestedCategory
      ? `*MENU*
\n${READMORE}\n`
      : `*Hello ${mention}, I am ${runtime.botName}* 👋
╭━━━━━━━━━━━━━━━━━━━━╮
│ ├─ 📜 ꕥ *${menuPrefix}rules* › Bot rules
│ ├─ 🌐 ꕥ *${menuPrefix}support* › Official group
│ └─ ⚡ ꕥ *${menuPrefix}reqbot* › Request a bot for your group 
╰━━━━━━━━━━━━━━━━━━━━╯
\n${READMORE}\n`;

    for (const cat of visibleCats) {
      const isCatDisabled = isGroup && disabledCats.has(cat) && !showStaff;
      if (isCatDisabled) continue;
      const emoji = categoryEmojis[cat] || "📌";
      const title = categoryTitles[cat] || cat.toUpperCase();
      const disabledTag = isGroup && disabledCats.has(cat) && showStaff ? " _(disabled)_" : "";
      const categoryPlugins = [...map.get(cat)].sort((a, b) => a.name.localeCompare(b.name));
      if (requestedCategory) {
        text += renderCategory(emoji, title, disabledTag, categoryPlugins, menuPrefix, true);
        text += `\n\n🌟 _Use *.menu* to return to the full command atlas._`;
      } else {
        text += renderCategory(emoji, title, disabledTag, categoryPlugins, menuPrefix);
      }
    }

    if (isGroup && !showStaff && disabledCats.size > 0) {
      text += `\n\n🔒 *Disabled in this group:* ${[...disabledCats].join(", ")}\n_Ask a staff member to enable them._`;
    }

    return sock.sendMessage(jid, {
      image: { url: runtime.botImage },
      caption: text,
      mentions: [sender],
    }, { quoted: msg });
  },
};
