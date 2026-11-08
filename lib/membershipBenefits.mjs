export function commandCooldownMultiplier(tier) {
  if (tier === "premium") return 0;
  if (tier === "basic") return 0.6;
  return 1;
}
