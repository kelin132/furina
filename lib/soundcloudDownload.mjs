const SOUNDCLOUD_HOSTS = new Set(["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"]);

/** Return SoundCloud's official per-track download route, or null for other URLs. */
export function soundcloudDownloadUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !SOUNDCLOUD_HOSTS.has(url.hostname.toLowerCase())) return null;
    if (url.username || url.password) return null;

    const segments = url.pathname.split("/").filter(Boolean);
    const alreadyDownloadRoute = segments.at(-1)?.toLowerCase() === "download";
    if (alreadyDownloadRoute) segments.pop();
    if (segments.length !== 2 || segments.some((segment) => segment.toLowerCase() === "sets")) return null;

    url.hostname = "soundcloud.com";
    url.pathname = "/" + segments.join("/") + (alreadyDownloadRoute ? "/download" : "/download");
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function isSoundCloudTrackUrl(value) {
  return Boolean(soundcloudDownloadUrl(value));
}

export function soundcloudTrackTitle(value) {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.at(-1)?.toLowerCase() === "download") segments.pop();
    const slug = decodeURIComponent(segments[1] || "");
    return slug.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim() || "SoundCloud track";
  } catch {
    return "SoundCloud track";
  }
}
