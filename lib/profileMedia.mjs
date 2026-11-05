const PROFILE_VIDEO_FIELDS = ["avatarVideo", "avatarVideoUrl", "profileVideoUrl", "profileVideo"];

function websiteUpdatedAt(record) {
  const value = record?.websiteProfileUpdatedAt;
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(String(value || ""));
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

function videoUrl(record) {
  return PROFILE_VIDEO_FIELDS
    .map((field) => record?.[field])
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || null;
}

/**
 * Website profile media is authoritative once its timestamp is present.
 * Resolve the newest website snapshot first so stale bot-side values cannot
 * hide a newly uploaded GIF or restore an animation the user removed.
 */
export function resolveProfileVideoSource({ cardUser, user, fallback = null }) {
  const websiteRecords = [
    { record: cardUser, timestamp: websiteUpdatedAt(cardUser), priority: 1 },
    { record: user, timestamp: websiteUpdatedAt(user), priority: 0 },
  ].filter((entry) => entry.timestamp !== null);

  if (websiteRecords.length) {
    websiteRecords.sort((a, b) => b.timestamp - a.timestamp || b.priority - a.priority);
    return videoUrl(websiteRecords[0].record);
  }

  const hasUserVideoField = user && PROFILE_VIDEO_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(user, field),
  );
  const userVideo = videoUrl(user);
  if (userVideo || hasUserVideoField) return userVideo;
  return videoUrl(cardUser) || fallback || null;
}
