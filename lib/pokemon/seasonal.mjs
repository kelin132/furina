const WEATHER = [
  { id: "clear", name: "Clear skies", boostType: null, weakType: null },
  { id: "rain", name: "Rain", boostType: "water", weakType: "fire" },
  { id: "sun", name: "Strong sunlight", boostType: "fire", weakType: "water" },
  { id: "snow", name: "Falling snow", boostType: "ice", weakType: "grass" },
  { id: "wind", name: "High winds", boostType: "flying", weakType: "rock" },
];

export const WEEKLY_BATTLE_RULES = [
  { id: "tidal", name: "Tidal Clash", boostType: "water", weakType: "fire" },
  { id: "solar", name: "Solar Front", boostType: "fire", weakType: "water" },
  { id: "wildgrowth", name: "Wild Growth", boostType: "grass", weakType: "electric" },
  { id: "stonewall", name: "Stonewall", boostType: "rock", weakType: "flying" },
];

function hashText(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function utcWeekKey(date = new Date()) {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
}

export function getWeatherForDestination(destination, date = new Date()) {
  const key = typeof destination === "string"
    ? destination
    : destination?.slug || destination?.name || "route";
  return WEATHER[hashText(`${utcDayKey(date)}:${key}`) % WEATHER.length];
}

export function getWeeklyBattleRule(date = new Date()) {
  return WEEKLY_BATTLE_RULES[hashText(utcWeekKey(date)) % WEEKLY_BATTLE_RULES.length];
}

export function getWeeklyBattleRuleById(id) {
  return WEEKLY_BATTLE_RULES.find((rule) => rule.id === id) || null;
}

export function applyBattleConditions(damage, moveType, { weatherId, weeklyRuleId } = {}) {
  const type = String(moveType || "").toLowerCase();
  let multiplier = 1;
  const weather = WEATHER.find((item) => item.id === weatherId);
  if (weather?.boostType === type) multiplier *= 1.1;
  if (weather?.weakType === type) multiplier *= 0.9;
  const rule = getWeeklyBattleRuleById(weeklyRuleId);
  if (rule?.boostType === type) multiplier *= 1.15;
  if (rule?.weakType === type) multiplier *= 0.9;
  return Math.max(0, Math.floor(Number(damage) * multiplier + 1e-9));
}
