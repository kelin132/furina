import test from "node:test";
import assert from "node:assert/strict";
import { buildQuickProfileCaption, resolveProfileImageSources } from "../plugins/economy/profile.js";
import { getProfileAvatarGeometry, resolveRole } from "../lib/profileGen.mjs";

test("WhatsApp profile avatar uses the larger circular crop", async () => {
  const geometry = await getProfileAvatarGeometry(null);
  assert.equal(geometry.size, 330);
  assert.equal(geometry.left, 375);
  assert.equal(geometry.top, 120);
});

test("quick profile caption uses the requested compact layout", () => {
  const caption = buildQuickProfileCaption({
    name: "KELIN",
    age: "10",
    birthday: "18 May",
    cards: "145",
    pokemon: "6",
    badges: "4",
    role: "Owner",
  });
  assert.match(caption, /^\*Edit your profile image here:\*\nhttps:\/\/aidoru\.zone\.id\/profile/);
  for (const line of [
    "❀ *Name* : `KELIN`",
    "❀ *Age* : `10`",
    "❀ *Bday* : `18 May`",
    "❀ *Cards*: `145`",
    "❀ *Pokémon*: `6`",
    "❀ *Badges* : `4`",
    "❀ *Role* : `Owner`",
  ]) assert.ok(caption.includes(line), `missing ${line}`);
});

test("staff level 3 profiles display Owner", () => {
  assert.equal(resolveRole({ staffLevel: 3 }), "Owner");
});

test("quick profiles retain the selected avatar and saved background", () => {
  assert.deepEqual(resolveProfileImageSources({
    cardUser: { profilePictureUrl: "https://images.example/avatar.jpg" },
    user: { profileBackground: "https://images.example/background.jpg" },
    profilePicFromSocket: "https://whatsapp.example/avatar.jpg",
  }), {
    profilePic: "https://images.example/avatar.jpg",
    profileBackground: "https://images.example/background.jpg",
  });

  assert.deepEqual(resolveProfileImageSources({
    cardUser: null,
    user: { profileBackground: "https://images.example/background.jpg" },
    profilePicFromSocket: "https://whatsapp.example/avatar.jpg",
  }), {
    profilePic: "https://whatsapp.example/avatar.jpg",
    profileBackground: "https://images.example/background.jpg",
  });
});
