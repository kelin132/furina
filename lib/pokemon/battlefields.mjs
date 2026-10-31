import { fileURLToPath } from "node:url";

export const BATTLEFIELDS = Object.freeze({
  meadow: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/meadow.jpg", import.meta.url)),
    enemy: { x: 0.75, footY: 0.62 },
    player: { x: 0.25, footY: 0.92 },
  },
  cavern: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/cavern.jpg", import.meta.url)),
    enemy: { x: 0.74, footY: 0.64 },
    player: { x: 0.26, footY: 0.92 },
  },
  pixelGrass: {
    imagePath: fileURLToPath(new URL("../../assets/pokemon/battlefields/pixel-grass.jpg", import.meta.url)),
    // Anchor the sprites directly over the field's existing grass circles.
    enemy: { x: 0.83, footY: 0.62 },
    player: { x: 0.19, footY: 0.975 },
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
