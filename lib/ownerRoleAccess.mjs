export function hasOwnerRole(isActualOwner, staffLevel) {
  return Boolean(isActualOwner) || Number(staffLevel || 0) >= 3;
}

export function canGrantStaffLevel3(isActualOwner, staffLevel) {
  return hasOwnerRole(isActualOwner, staffLevel);
}

export function canRunOwnerCommand(plugin, isActualOwner, staffLevel) {
  const requiresOwnerRole =
    Boolean(plugin?.isOwner) ||
    (plugin?.category === "owner" && !plugin?.public);
  if (!requiresOwnerRole) return true;
  if (plugin?.strictOwner) return Boolean(isActualOwner);
  const minimumStaffLevel = Number(plugin?.minStaffLevel) || 0;
  if (minimumStaffLevel > 0) {
    return Boolean(isActualOwner) || Number(staffLevel || 0) >= minimumStaffLevel;
  }
  return hasOwnerRole(isActualOwner, staffLevel);
}
