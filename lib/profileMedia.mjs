const PROFILE_VIDEO_FIELDS = ["avatarVideo", "avatarVideoUrl", "profileVideoUrl", "profileVideo"];
const PROFILE_BACKGROUND_VIDEO_FIELDS = ["profileBackgroundVideo", "profileBackgroundVideoUrl"];

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

function firstVideoUrl(record, fields) {
  return fields
    .map((field) => record?.[field])
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value)) || null;
}

function latestWebsiteRecord(cardUser, user) {
  const websiteRecords = [
    { record: cardUser, timestamp: websiteUpdatedAt(cardUser), priority: 1 },
    { record: user, timestamp: websiteUpdatedAt(user), priority: 0 },
  ].filter((entry) => entry.timestamp !== null);
  if (websiteRecords.length) {
    websiteRecords.sort((a, b) => b.timestamp - a.timestamp || b.priority - a.priority);
    return websiteRecords[0].record;
  }
  return [cardUser, user].find((record) =>
    record && Object.prototype.hasOwnProperty.call(record, "websiteProfileUpdatedAt"),
  ) || null;
}

/**
 * Website profile media is authoritative once its timestamp is present.
 * Resolve the newest website snapshot first so stale bot-side values cannot
 * hide a newly uploaded GIF or restore an animation the user removed.
 */
export function resolveProfileVideoSource({ cardUser, user, fallback = null }) {
  const websiteRecord = latestWebsiteRecord(cardUser, user);
  if (websiteRecord) return videoUrl(websiteRecord);

  // The website keeps its profile snapshot in the card collection, while older
  // WhatsApp user documents may still contain an unrelated avatar URL. Even
  // when those old documents have no timestamp, an explicit website snapshot
  // must win over them.
  const hasUserVideoField = user && PROFILE_VIDEO_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(user, field),
  );
  const userVideo = videoUrl(user);
  if (userVideo || hasUserVideoField) return userVideo;
  return videoUrl(cardUser) || fallback || null;
}

export function resolveProfileBackgroundVideoSource({ cardUser, user, fallback = null }) {
  const websiteRecord = latestWebsiteRecord(cardUser, user);
  if (websiteRecord) return firstVideoUrl(websiteRecord, PROFILE_BACKGROUND_VIDEO_FIELDS);
  const userHasField = user && PROFILE_BACKGROUND_VIDEO_FIELDS.some((field) =>
    Object.prototype.hasOwnProperty.call(user, field),
  );
  if (userHasField) return firstVideoUrl(user, PROFILE_BACKGROUND_VIDEO_FIELDS);
  return firstVideoUrl(cardUser, PROFILE_BACKGROUND_VIDEO_FIELDS) || fallback || null;
}

export function resolveWebsiteProfileField({ cardUser, user, field, fallback = null }) {
  const websiteRecord = latestWebsiteRecord(cardUser, user);
  if (websiteRecord) return websiteRecord[field] ?? fallback;
  if (user && Object.prototype.hasOwnProperty.call(user, field)) return user[field] ?? fallback;
  return cardUser?.[field] ?? fallback;
}
