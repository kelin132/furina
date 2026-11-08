export const CURRENCY_NAME = "$";
export const STARTING_MONEY = 30_000;
export const BASE_BANK_LIMIT = 50_000;

// The shop and bankLimitForUser use this same source of truth.
// Level 0 is the starter account and is free; every later tier is bought in
// order from .shop banking.
export const BANK_LIMIT_TIERS = [
  { level: 0, limit: 50_000, price: 0, item: null, label: "Starter" },
  { level: 1, limit: 250_000, price: 10_000, item: "bank_limit_tier_1", label: "Basic Plus" },
  { level: 2, limit: 1_000_000, price: 50_000, item: "bank_limit_tier_2", label: "Vault" },
  { level: 3, limit: 5_000_000, price: 250_000, item: "bank_limit_tier_3", label: "Reserve" },
  { level: 4, limit: 25_000_000, price: 1_000_000, item: "bank_limit_tier_4", label: "Fortune" },
  { level: 5, limit: 100_000_000, price: 5_000_000, item: "bank_limit_tier_5", label: "Grand Vault" },
];

const BETTING_TIERS = [
  { minimum: 1, maximum: 50_000, winRate: 0.5, multiplier: 1.7 },
  { minimum: 60_000, maximum: 200_000, winRate: 0.45, multiplier: 1.9 },
  { minimum: 210_000, maximum: 500_000, winRate: 0.4, multiplier: 2.2 },
  { minimum: 510_000, maximum: 1_000_000, winRate: 0.3, multiplier: 3 },
  { minimum: 2_000_000, maximum: 5_000_000, winRate: 0.45, multiplier: 2 },
];

function compact(value) {
  const amount = Math.abs(Number(value) || 0);
  if (amount >= 1e12) return `${trim(amount / 1e12)}t`;
  if (amount >= 1e9) return `${trim(amount / 1e9)}b`;
  if (amount >= 1e6) return `${trim(amount / 1e6)}m`;
  if (amount >= 1e3) return `${trim(amount / 1e3)}k`;
  return amount.toLocaleString("en-US");
}

function trim(value) {
  return value.toFixed(1).replace(/\.0$/, "");
}

export function formatRyu(value) {
  const amount = Number(value) || 0;
  const sign = amount < 0 ? "-" : "";
  return `${sign}${CURRENCY_NAME}${compact(amount)}`;
}

export function bankTierForUser(user = {}) {
  const level = Math.max(0, Math.min(
    BANK_LIMIT_TIERS.length - 1,
    Math.floor(Number(user.bankUpgradeLevel) || 0),
  ));
  return BANK_LIMIT_TIERS[level];
}

export function bankLimitForUser(user = {}) {
  const levelBonus = Math.max(0, Math.floor(Number(user.level) || 0)) * 10_000;
  return bankTierForUser(user).limit + levelBonus;
}

export function getBettingTier(amount) {
  const wager = Math.max(1, Math.floor(Number(amount) || 1));
  return [...BETTING_TIERS].reverse().find((tier) => wager >= tier.minimum) || BETTING_TIERS[0];
}

export function bettingTierLabel(tier) {
  const upper = Number.isFinite(tier.maximum) ? formatRyu(tier.maximum) : "$11m+";
  return `${formatRyu(tier.minimum)} – ${upper}: ${tier.winRate * 100}% win / ×${tier.multiplier}`;
}

export { BETTING_TIERS };