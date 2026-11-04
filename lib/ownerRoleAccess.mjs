export function hasOwnerRole(isActualOwner, staffLevel) {
  return Boolean(isActualOwner) || Number(staffLevel || 0) >= 3;
}

export function canRunOwnerCommand(plugin, isActualOwner, staffLevel) {
  const requiresOwnerRole =
    Boolean(plugin?.isOwner) ||
    (plugin?.category === "owner" && !plugin?.public);
  if (!requiresOwnerRole) return true;
  if (plugin?.strictOwner) return Boolean(isActualOwner);
  return hasOwnerRole(isActualOwner, staffLevel);
}
