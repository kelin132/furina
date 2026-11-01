import test from "node:test";
import assert from "node:assert/strict";
import { isSoundCloudTrackUrl, soundcloudDownloadUrl, soundcloudTrackTitle } from "./soundcloudDownload.mjs";

test("constructs the official download route and preserves query tokens", () => {
  assert.equal(soundcloudDownloadUrl("https://soundcloud.com/artist/my-track?si=share"), "https://soundcloud.com/artist/my-track/download?si=share");
});

test("does not duplicate an existing official download route", () => {
  assert.equal(soundcloudDownloadUrl("https://www.soundcloud.com/artist/my-track/download?secret_token=abc"), "https://soundcloud.com/artist/my-track/download?secret_token=abc");
});

test("accepts only HTTPS SoundCloud track URLs, not playlists or lookalike domains", () => {
  assert.equal(isSoundCloudTrackUrl("https://soundcloud.com/artist/track"), true);
  assert.equal(isSoundCloudTrackUrl("https://soundcloud.com/artist/sets/mix"), false);
  assert.equal(isSoundCloudTrackUrl("https://evil-soundcloud.com/artist/track"), false);
  assert.equal(isSoundCloudTrackUrl("http://soundcloud.com/artist/track"), false);
  assert.equal(isSoundCloudTrackUrl("https://soundcloud.com/artist/track/extra"), false);
});

test("extracts a readable title from a SoundCloud track URL", () => {
  assert.equal(soundcloudTrackTitle("https://soundcloud.com/artist/a-song_title"), "a song title");
});
