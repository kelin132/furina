/**
 * Economy item catalogue.
 *
 * SHOP_ITEMS contains only items that are backed by a live WhatsApp command.
 * ITEM_DEFINITIONS also contains loot and work-haul items so everything that
 * reaches a player's inventory can be displayed and sold.
 */

import { BANK_LIMIT_TIERS } from "./currency.js";

const BANK_SHOP_ITEMS = Object.fromEntries(
  BANK_LIMIT_TIERS
    .filter((tier) => tier.level > 0)
    .map((tier) => [
      tier.item,
      {
        price: tier.price,
        orbCost: 0,
        gemCost: 0,
        emoji: "🏦",
        rarity: tier.level >= 4 ? "legendary" : tier.level >= 2 ? "rare" : "common",
        xpBonus: 0,
        sellPct: 0,
        category: "banking",
        bankTier: tier.level,
        inventory: false,
        description: `Raises your bank limit to ${tier.limit.toLocaleString()}.`,
      },
    ]),
);

export const SHOP_ITEMS = {
  // Live requirements/passives used by .rob, .heist and .dig.
  gun: {
    price: 8_000, orbCost: 0, gemCost: 0, emoji: "🔫",
    rarity: "common", xpBonus: 0, sellPct: 0.5, category: "weapons",
    description: "Activates the gun required by .rob and .heist for 3 days.",
    inventory: true,
  },
  diamond_shovel: {
    price: 75_000, orbCost: 0, gemCost: 0, emoji: "🪏",
    rarity: "rare", xpBonus: 0, sellPct: 0.4, category: "tools",
    description: "Improves your chance of finding bonus Genesis Crystals while digging.",
    inventory: true,
  },

  // Live timed/consumable effects handled by .use.
  rob_charm: {
    price: 75_000, orbCost: 0, gemCost: 0, emoji: "🧿",
    rarity: "rare", xpBonus: 0, sellPct: 0.3, category: "consumables",
    description: "Protects your wallet from robbers for 24 hours.",
    useEffect: "rob_shield:86400000",
    inventory: true,
  },
  stealth_hood: {
    price: 40_000, orbCost: 0, gemCost: 0, emoji: "🪄",
    rarity: "rare", xpBonus: 0, sellPct: 0.3, category: "consumables",
    description: "Reduces robbery fines for 1 hour.",
    useEffect: "stealth:3600000",
    inventory: true,
  },
  xp_bomb: {
    price: 30_000, orbCost: 0, gemCost: 1, emoji: "💥",
    rarity: "rare", xpBonus: 0, sellPct: 0.4, category: "consumables",
    description: "Consume for +500 XP.",
    useEffect: "xp+500",
    inventory: true,
  },

  // Items used by .dig and .fish, and therefore also valid shop purchases.
  basic_fishing_rod: {
    price: 1_000, orbCost: 0, gemCost: 0, emoji: "🎣",
    rarity: "common", xpBonus: 0, sellPct: 0.3, category: "tools",
    description: "Required to fish; stays in your inventory.",
    inventory: true,
  },
  pickaxe: {
    price: 2_500, orbCost: 0, gemCost: 0, emoji: "⛏️",
    rarity: "common", xpBonus: 0, sellPct: 0.3, category: "tools",
    description: "Required to mine; stays in your inventory.",
    inventory: true,
  },
  getaway_tool: {
    price: 250_000, orbCost: 0, gemCost: 2, emoji: "🧰",
    rarity: "rare", xpBonus: 0, sellPct: 0.3, category: "tools",
    description: "Escape jail once; consumed when used with .escape.",
    inventory: true,
  },
  hack_kit: {
    price: 1_000_000, orbCost: 0, gemCost: 0, emoji: "💻",
    rarity: "rare", xpBonus: 0, sellPct: 0.3, category: "tools",
    description: "Required for a group heist; consumed when the crew starts.",
    inventory: true,
  },
  med_kit: {
    price: 250_000, orbCost: 0, gemCost: 0, emoji: "🩹",
    rarity: "common", xpBonus: 0, sellPct: 0.3, category: "tools",
    description: "Required for a group heist; consumed when the crew starts.",
    inventory: true,
  },
  potion: {
    price: 500, orbCost: 0, gemCost: 0, emoji: "🧪",
    rarity: "common", xpBonus: 0, sellPct: 0.5, category: "potions",
    description: "A small potion that grants XP when consumed.",
    useEffect: "xp+50", inventory: true,
  },
  small_health_potion: {
    price: 1_500, orbCost: 0, gemCost: 0, emoji: "🩹",
    rarity: "common", xpBonus: 0, sellPct: 0.4, category: "potions",
    description: "A recovery item that grants XP when consumed.",
    useEffect: "xp+25", inventory: true,
  },
  scroll: {
    price: 2_000, orbCost: 0, gemCost: 0, emoji: "📜",
    rarity: "common", xpBonus: 0, sellPct: 0.4, category: "scrolls",
    description: "Read it for XP and a small cash reward.",
    useEffect: "xp+30,cash+100", inventory: true,
  },
  elixir: {
    price: 1_000, orbCost: 0, gemCost: 0, emoji: "🍶",
    rarity: "common", xpBonus: 0, sellPct: 0.4, category: "potions",
    description: "Consume it for XP and a small cash reward.",
    useEffect: "xp+100,cash+200", inventory: true,
  },

  // Banking is a service, not an inventory item. Purchase handling in
  // shop.js upgrades the user's bank tier and does not add these to the bag.
  ...BANK_SHOP_ITEMS,
};

// Loot that can be fished/digged but is not sold as a separate shop product.
export const LOOT_ITEMS = {
  boots: {
    emoji: "🥾", sellPrice: 1_400,
    description: "A worn pair of boots recovered while fishing.",
  },
};

// Work-haul items are intentionally not in the shop, but they are real
// inventory items and must be sellable after .work collect.
export const WORK_LOOT_ITEMS = {
  raw_ore:       { emoji: "🪨", sellPrice: 2_500 },
  iron_ore:      { emoji: "⛓️", sellPrice: 5_000 },
  gold_nugget:   { emoji: "🪙", sellPrice: 15_000 },
  gemstone:      { emoji: "💎", sellPrice: 30_000 },
  iron_pickaxe:  { emoji: "⛏️", sellPrice: 6_000 },
  steel_hammer:  { emoji: "🔨", sellPrice: 10_000 },
  tool_kit:      { emoji: "🧰", sellPrice: 8_000 },
  spare_parts:   { emoji: "⚙️", sellPrice: 4_500 },
  tactical_vest: { emoji: "🦺", sellPrice: 9_000 },
  supply_crate:  { emoji: "📦", sellPrice: 12_000 },
  gear_pack:     { emoji: "🎒", sellPrice: 18_000 },
  utility_belt:  { emoji: "🧷", sellPrice: 7_500 },
};

export const ITEM_DEFINITIONS = {
  ...SHOP_ITEMS,
  ...LOOT_ITEMS,
  ...WORK_LOOT_ITEMS,
};

export function getItemDefinition(name) {
  return ITEM_DEFINITIONS[String(name).toLowerCase()];
}

export function getSellPrice(name) {
  const item = getItemDefinition(name);
  if (!item) return 0;
  if (Number.isFinite(item.sellPrice)) return Math.max(0, Math.floor(item.sellPrice));
  if (item.sellPct > 0 && item.price > 0) {
    return Math.max(0, Math.floor(item.price * item.sellPct));
  }
  return 0;
}

export const RARITY_COLORS = { common: "⚪", rare: "🔵", legendary: "🟡" };

export const SHOP_CATEGORIES = {
  weapons:     { emoji: "🗡️", label: "Weapons & Requirements" },
  tools:       { emoji: "🎣", label: "Tools & Exploration" },
  consumables: { emoji: "🎟️", label: "Boosts & Protection" },
  potions:     { emoji: "🧪", label: "Potions & Recovery" },
  scrolls:     { emoji: "📜", label: "Scrolls & XP" },
  banking:     { emoji: "🏦", label: "Bank Limit Tiers" },
};

/** Weighted loot table for .dig. */
export const DIG_LOOT = [
  { type: "cash", min: 50, max: 400, weight: 50, label: "💰 Cash" },
  { type: "cash", min: 400, max: 1200, weight: 15, label: "💰 Cash" },
  { type: "item", name: "potion", weight: 12 },
  { type: "item", name: "scroll", weight: 8 },
  { type: "item", name: "pickaxe", weight: 5 },
  { type: "orbs", min: 1, max: 5, weight: 7 },
  { type: "item", name: "small_health_potion", weight: 1 },
  { type: "nothing", weight: 2 },
];

/** Weighted loot table for .fish. */
export const FISH_LOOT = [
  { type: "cash", min: 9_000, max: 25_000, weight: 44, label: "💰 Cash" },
  { type: "cash", min: 25_001, max: 90_000, weight: 12, label: "💰 Rare Cash" },
  { type: "item", name: "boots", weight: 15 },
  { type: "item", name: "basic_fishing_rod", weight: 12 },
  { type: "item", name: "scroll", weight: 8 },
  { type: "pokemon_ball", name: "pokeball", weight: 4 },
  { type: "pokemon_ball", name: "greatball", weight: 1 },
  { type: "orbs", min: 1, max: 3, weight: 10 },
  { type: "item", name: "elixir", weight: 4 },
  { type: "nothing", weight: 1 },
];

export function rollLoot(table) {
  const total = table.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = Math.random() * total;
  for (const entry of table) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return table[table.length - 1];
}