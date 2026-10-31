import { fileURLToPath } from "node:url";

export const BATTLEFIELDS = Object.freeze({
  meadow: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/meadow.jpg", import.meta.url)),
    enemy: { x: 0.75, footY: 0.62 },
    player: { x: 0.25, footY: 0.94 },
    platform: { top: "#b9ed82", bottom: "#56a94d", rim: "#347849" },
  },
  cavern: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/cavern.jpg", import.meta.url)),
    enemy: { x: 0.75, footY: 0.62 },
    player: { x: 0.25, footY: 0.94 },
    platform: { top: "#e4a25e", bottom: "#784a36", rim: "#4b302c" },
  },
  pixelGrass: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/pixel-grass.jpg", import.meta.url)),
    // These centers line up with the two circular grass patches in the supplied field.
    enemy: { x: 0.83, footY: 0.62 },
    player: { x: 0.19, footY: 0.975 },
    platform: null,
  },
});

export const BATTLEFIELD_IDS = Object.freeze(Object.keys(BATTLEFIELDS));

let previousBattlefieldId = null;

export function randomBattlefieldId() {
  const choices = BATTLEFIELD_IDS.filter((id) => id !== previousBattlefieldId);
  const next = choices[Math.floor(Math.random() * choices.length)];
  previousBattlefieldId = next;
  return next;
}
