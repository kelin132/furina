export function getBanTargetBlock({
  isActualOwner = false,
  targetIsOwner = false,
  targetIsMod = false,
  targetStaffLevel = 0,
  moderationStatusAvailable = true,
} = {}) {
  if (isActualOwner) return null;
  if (moderationStatusAvailable === false) return "unavailable";
  if (targetIsOwner || targetIsMod || Number(targetStaffLevel || 0) >= 1) {
    return "staff";
  }
  return null;
}
