// plugins/pokemon/bag.js
// Show everything a trainer has in their bag, grouped by category

import { getTrainer } from "../../lib/pokemon/players.mjs";
import { MART_ITEMS, fetchApiItem } from "../../lib/pokemon/martItems.mjs";

// Category display order and labels
const CAT_META = {
  ball:    { label: "🎾 *POKÉBALLS*" },
  heal:    { label: "💊 *HEALING ITEMS*" },
  battle:  { label: "⚔️  *BATTLE ITEMS*" },
  stone:   { label: "🪨 *EVOLUTION STONES*" },
  mega:    { label: "💠 *MEGA EVOLUTION STONES*" },
  cure:    { label: "🩹 *STATUS CURES*" },
  vitamin: { label: "💊 *VITAMINS & BOOSTERS*" },
  key:     { label: "🔑 *KEY ITEMS*" },
  other:   { label: "🎒 *OTHER ITEMS*" },
};

export default {
  name: "bag",
  aliases: ["inventory", "inv", "items", "pokeitem"],
  description: "View everything in your trainer bag",
  category: "pokemon",
  usage: ".bag",
  cooldown: 5,

  async run({ sock, msg, sender }) {
    const jid = msg.key.remoteJid;

    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, { text: "❌ Start your journey first! Use `.startjourney`" }, { quoted: msg });
    }

    const inv = trainer.inventory || {};

    // Group owned items by category
    const groups = {};
    let totalItems = 0;

    const ownedItems = Object.entries(inv).filter(([, qty]) => qty && qty > 0);
    const itemDescriptions = await Promise.all(ownedItems.map(async ([key]) => {
      const item = MART_ITEMS[key];
      if (!item) return [key, "No Pokémon item data available."];
      if (item.category === "battle") return [key, item.desc];
      const apiItem = await fetchApiItem(item.slug || key);
      return [key, apiItem?.effect || item.desc || "No effect details available."];
    }));
    const descriptionByKey = new Map(itemDescriptions);

    for (const [key, qty] of ownedItems) {
      if (!qty || qty <= 0) continue;
      const itemData = MART_ITEMS[key];
      const cat      = itemData?.category || "other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({
        key,
        qty,
        emoji: itemData?.emoji || "📦",
        name:  itemData?.name  || key,
        desc: descriptionByKey.get(key) || itemData?.desc || "",
      });
      totalItems += qty;
    }

    if (totalItems === 0) {
      return sock.sendMessage(jid, {
        text:
`🎒 *${trainer.username}'s BAG*

Your bag is empty!
Visit \`.mart\` to buy items.`,
      }, { quoted: msg });
    }

    // Keep the bag compact and readable; quantities use inline code formatting.
    const catOrder = ["ball", "heal", "cure", "battle", "vitamin", "stone", "mega", "key", "other"];
    const rows = catOrder
      .filter(cat => groups[cat] && groups[cat].length > 0)
      .flatMap(cat => {
        return groups[cat].map(it => ({
          category: CAT_META[cat]?.label || "🎒 ITEMS",
          text: `• ${it.emoji} ${it.name}: \`${it.qty}\`\n  ↳ ${it.desc}`,
        }));
      });

    const lines = [`🎒 ${trainer.username}'s Bag`, ""];
    let lastCategory = "";
    for (const row of rows) {
      if (row.category !== lastCategory) {
        if (lastCategory) lines.push("");
        lines.push(row.category);
        lastCategory = row.category;
      }
      lines.push(row.text);
    }
    lines.push("", `Total items: \`${totalItems}\``, "", "Buy more at `.mart`.");
    const text = lines.join("\n");

    await sock.sendMessage(jid, { text }, { quoted: msg });
  },
};
