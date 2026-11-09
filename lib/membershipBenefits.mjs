export function commandCooldownMultiplier(tier) {
  if (tier === "premium") return 0;
  if (tier === "basic") return 0.6;
  return 1;
}

export function membershipWinRate(baseRate, tier) {
  const boost = tier === "premium" ? 0.1 : tier === "basic" ? 0.05 : 0;
  return Math.max(0, Math.min(0.95, Number(baseRate) + boost));
}

export function membershipDailyRenameLimit(tier) {
  if (tier === "premium") return Number.MAX_SAFE_INTEGER;
  if (tier === "basic") return 5;
  return 1;
}

export function harareDateKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
