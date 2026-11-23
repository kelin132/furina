// plugins/pokemon/spawnpoke.js
// Spawn a random wild Pokémon in the group

import {
  fetchRandom,
  getImageMessage,
} from "../../lib/pokemon/api.mjs";

import {
  getWild,
  setWild,
  clearWild,
  reserveWildSpawn,
  releaseWildSpawn,
} from "../../lib/pokemon/wildState.mjs";

import {
  getTrainer,
} from "../../lib/pokemon/players.mjs";

import {
  randomWildLevel,
  getMovesForType,
} from "../../lib/pokemon/gameLogic.mjs";

import {
  getRepel,
} from "../../lib/pokemon/itemState.mjs";

const SPAWN_COOLDOWN_MS = 100 * 1000; // 100 seconds
const spawnCooldowns = new Map();

export default {
  name: "spawnpoke",
  aliases: ["wildpoke", "encounter"],
  description: "Spawn a random wild Pokémon in the group",
  category: "pokemon",
  usage: ".spawnpoke",

  async run({ sock, msg, sender }) {
    const jid = msg.key.remoteJid;

    const trainer = await getTrainer(sender);

    if (!trainer) {
      return sock.sendMessage(jid, {
        text:
          "❌ You haven't started your journey yet!\n" +
          "Use `.startjourney` to begin.",
      }, {
        quoted: msg,
      });
    }

    const activeRepel = getRepel(jid);

    if (activeRepel) {
      return sock.sendMessage(jid, {
        text:
          `🌿 *${activeRepel.itemName}* is active.\n` +
          "Wild Pokémon cannot appear right now.",
      }, {
        quoted: msg,
      });
    }

    if (getWild(jid)) {
      return sock.sendMessage(jid, {
        text:
          "⚠️ A wild Pokémon is already here!\n" +
          "Use `.catch` to battle it.",
      }, {
        quoted: msg,
      });
    }

    const lastSpawn = spawnCooldowns.get(jid) || 0;
    const elapsed = Date.now() - lastSpawn;

    if (elapsed < SPAWN_COOLDOWN_MS) {
      const remaining = Math.ceil(
        (SPAWN_COOLDOWN_MS - elapsed) / 1000
      );

      return sock.sendMessage(jid, {
        text:
          "⏳ Wild Pokémon spawn cooldown!\n" +
          `Wait \`${remaining}s\` before spawning again.`,
      }, {
        quoted: msg,
      });
    }

    if (!reserveWildSpawn(jid)) {
      return sock.sendMessage(jid, {
        text:
          "⏳ A Pokémon spawn is already being prepared for this group.\n" +
          "Try again in a moment.",
      }, {
        quoted: msg,
      });
    }

    try {
      let apiData;

      try {
        apiData = await fetchRandom();
      } catch (error) {
        console.error("Failed to fetch random Pokémon:", error);

        return sock.sendMessage(jid, {
          text:
            "❌ Couldn't fetch a Pokémon right now.\n" +
            "Try again!",
        }, {
          quoted: msg,
        });
      }

      if (!apiData) {
        return sock.sendMessage(jid, {
          text: "❌ Couldn't fetch a Pokémon right now. Try again!",
        }, {
          quoted: msg,
        });
      }

      const level = randomWildLevel();

      const baseHp = Number(apiData.baseHp) || 50;
      const baseAttack = Number(apiData.baseAttack) || 10;
      const baseDefense = Number(apiData.baseDefense) || 10;
      const baseSpeed = Number(apiData.baseSpeed) || 10;

      const maxHp = Math.max(
        10,
        Math.floor(baseHp * (1 + level * 0.05))
      );

      const types = Array.isArray(apiData.types)
        ? apiData.types.filter(Boolean)
        : [];

      if (types.length === 0) {
        types.push("normal");
      }

      const wildPoke = {
        pokedexId: apiData.pokedexId,
        name: apiData.name,
        displayName: apiData.displayName || apiData.name,
        types,
        primaryType: apiData.primaryType || types[0] || "normal",
        level,
        hp: maxHp,
        maxHp,
        attack: Math.max(
          5,
          Math.floor(baseAttack * (1 + level * 0.05))
        ),
        defense: Math.max(
          5,
          Math.floor(baseDefense * (1 + level * 0.05))
        ),
        speed: Math.max(
          5,
          Math.floor(baseSpeed * (1 + level * 0.05))
        ),
        imageUrl: apiData.imageUrl || null,
        shiny: Math.random() < 0.005,
        moves: getMovesForType(
          apiData.primaryType || types[0] || "normal",
          types,
          level
        ),
      };

      setWild(jid, wildPoke, sender, (pokeName) => {
        sock.sendMessage(jid, {
          text:
            `🌿 *${pokeName}* got tired of waiting and fled away.\n` +
            "Use `.spawnpoke` to encounter another Pokémon.",
        }).catch(() => {});
      });

      const typeEmojis = {
        fire: "🔥",
        water: "💧",
        grass: "🍃",
        electric: "⚡",
        psychic: "🔮",
        normal: "⭐",
        flying: "🌤️",
        bug: "🐛",
        poison: "☠️",
        rock: "🪨",
        ground: "🌍",
        ice: "❄️",
        fighting: "🥊",
        ghost: "👻",
        dragon: "🐉",
        dark: "🌑",
        steel: "⚙️",
        fairy: "🌸",
      };

      const typeStr = types
        .map(type => `${typeEmojis[type] || ""}${type}`)
        .join(" / ");

      const spawnCaption =
`🌿 *A WILD POKÉMON APPEARED!*

🐾 Name: *${wildPoke.displayName}${wildPoke.shiny ? " ✨ SHINY" : ""}*
🏷️ Type: ${typeStr}
📊 Level: \`${level}\`
❤️ HP: \`${maxHp}/${maxHp}\`

Use \`.catch\` to battle this Pokémon!
⏰ It will flee in 30 minutes.`;

      try {
        const imgMsg = await getImageMessage(apiData);

        if (imgMsg) {
          try {
            await sock.sendMessage(jid, {
              ...imgMsg,
              caption: spawnCaption,
            }, {
              quoted: msg,
            });

            spawnCooldowns.set(jid, Date.now());
            return;
          } catch (error) {
            console.error("Failed to send Pokémon image:", error);
          }
        }
      } catch (error) {
        console.error("Failed to prepare Pokémon image:", error);
      }

      await sock.sendMessage(jid, {
        text: spawnCaption,
      }, {
        quoted: msg,
      });

      spawnCooldowns.set(jid, Date.now());
    } catch (error) {
      clearWild(jid);
      console.error("Spawn Pokémon error:", error);

      try {
        await sock.sendMessage(jid, {
          text: "❌ Something went wrong while spawning the Pokémon.",
        }, {
          quoted: msg,
        });
      } catch {}
    } finally {
      // Always release the per-group reservation, including on errors.
      releaseWildSpawn(jid);
    }
  },
};