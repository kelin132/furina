import assert from "node:assert/strict";
import test from "node:test";
import { resolveProfileVideoSource } from "../lib/profileMedia.mjs";

test("uses the latest website GIF instead of a stale bot profile URL", () => {
  assert.equal(resolveProfileVideoSource({
    user: { avatarVideo: "https://old.example/profile.gif" },
    cardUser: {
      avatarVideo: "https://new.example/profile.gif",
      websiteProfileUpdatedAt: new Date("2026-11-05T10:00:00Z"),
    },
  }), "https://new.example/profile.gif");
});

test("honors a newer website update that removed the moving picture", () => {
  assert.equal(resolveProfileVideoSource({
    user: { avatarVideo: "https://old.example/profile.gif" },
    cardUser: {
      avatarVideo: null,
      websiteProfileUpdatedAt: new Date("2026-11-05T10:00:00Z"),
    },
  }), null);
});

test("uses a newer website user record over an older mirrored card record", () => {
  assert.equal(resolveProfileVideoSource({
    user: {
      avatarVideo: null,
      websiteProfileUpdatedAt: new Date("2026-11-05T10:00:00Z"),
    },
    cardUser: {
      avatarVideo: "https://old.example/profile.gif",
      websiteProfileUpdatedAt: new Date("2026-11-04T10:00:00Z"),
    },
  }), null);
});

test("keeps the current non-website and Discord animation fallbacks", () => {
  assert.equal(resolveProfileVideoSource({
    user: {},
    cardUser: { avatarVideo: "https://cards.example/profile.mp4" },
  }), "https://cards.example/profile.mp4");
  assert.equal(resolveProfileVideoSource({ user: {}, cardUser: null, fallback: "https://discord.example/avatar.gif" }),
    "https://discord.example/avatar.gif");
});
