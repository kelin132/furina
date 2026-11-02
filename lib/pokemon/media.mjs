import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mediaRoot = new URL("../../assets/pokemon/", import.meta.url);
const animationFiles = {
  pokeball: "animations/pokeball.mp4",
  catch: "animations/catch.mp4",
  "explore-walk": "animations/explore-walk.mp4",
  "pokemon-center": "animations/pokemon-center.mp4",
};
const bufferCache = new Map();

function assetUrl(relativePath) {
  return new URL(relativePath, mediaRoot);
}

export function readPokemonAnimation(name) {
  const relativePath = animationFiles[name];
  if (!relativePath) throw new Error("Unknown Pokémon animation: " + name);
  if (!bufferCache.has(relativePath)) {
    bufferCache.set(relativePath, readFile(assetUrl(relativePath)));
  }
  return bufferCache.get(relativePath);
}

let mapImagePromise;
export function readPokemonMapImage() {
  if (!mapImagePromise) mapImagePromise = readFile(assetUrl("exploration/map.jpg"));
  return mapImagePromise;
}

export function pokemonFusionSpritePath(index) {
  const spriteIndex = Math.max(1, Math.min(16, Math.trunc(Number(index) || 1)));
  const paddedIndex = String(spriteIndex).padStart(2, "0");
  return fileURLToPath(assetUrl("fusions/fusion-" + paddedIndex + ".png"));
}
