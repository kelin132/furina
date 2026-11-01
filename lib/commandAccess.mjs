export function getCommandAccessBlock({
  isOwner = false,
  isBanned = false,
  isJailed = false,
  moderationStatusAvailable = true,
} = {}) {
  if (isOwner) return null;
  if (!moderationStatusAvailable) return "unavailable";
  if (isBanned) return "banned";
  if (isJailed) return "jailed";
  return null;
}
