import { GYMS, gymById, gymBadgeId } from "../../lib/pokemon/gymData.mjs";
import { getTrainer } from "../../lib/pokemon/players.mjs";
import { healPartyAndGet } from "../../lib/pokemon/pokemonDb.mjs";
import { createWebBattleRoom, webBattleUrl } from "../../lib/webBattleRoom.mjs";
import { findActivePokemonBattle } from "../../lib/pokemon/activeBattle.mjs";

function unlocked(gym, badges) {
  if (!gym.unlockAfter) return true;
  return badges.includes(gymBadgeId(gym.unlockAfter)) || badges.includes(gym.unlockAfter);
}

export default {
  name: "gym",
  aliases: ["gyms", "gymchallenge"],
  description: "Challenge themed Pokémon gyms in the shared AIDORU web arena",
  category: "pokemon",
  usage: ".gyms  OR  .gym <gym-name>",

  async run({ sock, msg, sender, args }) {
    const jid = msg.key.remoteJid;
    const trainer = await getTrainer(sender);
    if (!trainer) return sock.sendMessage(jid, { text: "❌ Start your journey first with `.startjourney`." }, { quoted: msg });
    const badges = Array.isArray(trainer.badges) ? trainer.badges.map(String) : [];
    const cooldownUntil = trainer.gymCooldownUntil ? new Date(String(trainer.gymCooldownUntil)).getTime() : 0;
    if (Number.isFinite(cooldownUntil) && cooldownUntil > Date.now() && args[0]) {
      const remainingHours = Math.ceil((cooldownUntil - Date.now()) / 3600000);
      return sock.sendMessage(jid, { text: `⏳ Gym cooldown active. You can challenge the next gym in about ${remainingHours} hour${remainingHours === 1 ? "" : "s"}.` }, { quoted: msg });
    }
    const selected = args[0] ? gymById(args[0]) : null;

    if (!selected) {
      const lines = GYMS.map((gym, index) => {
        const earned = badges.includes(gymBadgeId(gym.id)) || badges.includes(gym.id);
        const open = unlocked(gym, badges);
        const status = earned ? "`badge earned` ✅" : open ? "`unlocked` 🔓" : `🔒 needs \`${gym.unlockAfter}\``;
        return `\`${index + 1}.\` *${gym.name}* — \`${gym.type}\`\n   Leader: *${gym.leader}* · ${status}\n   Reward: \`$${gym.rewardCoins.toLocaleString()}\` coins + \`${gym.rewardXp.toLocaleString()}\` XP`;
      });
      return sock.sendMessage(jid, { text: `🏟️ *AIDORU GYM CIRCUIT*\n\n${lines.join("\n\n")}\n\nUse \`.gym <name>\` to open a direct web arena.` }, { quoted: msg });
    }

    if (!unlocked(selected, badges)) {
      return sock.sendMessage(jid, { text: `🔒 *${selected.name}* is locked. Earn the *${gymById(selected.unlockAfter)?.badge || "previous badge"}* first.` }, { quoted: msg });
    }

    let activeBattle;
    try {
      activeBattle = await findActivePokemonBattle(sender);
    } catch (error) {
      console.error("[pokemon-gym] battle status lookup failed:", error?.message || error);
      return sock.sendMessage(jid, { text: "⚠️ I couldn't verify your battle status, so I paused the gym challenge. Please try again shortly." }, { quoted: msg });
    }
    if (activeBattle) {
      return sock.sendMessage(jid, { text: "❌ Finish your active Pokémon battle before opening another battle or healing for a gym." }, { quoted: msg });
    }

    const party = await healPartyAndGet(sender);
    if (!party.some((pokemon) => Number(pokemon.hp || 0) > 0)) {
      return sock.sendMessage(jid, { text: "❌ You need at least one healthy Pokémon in your party." }, { quoted: msg });
    }

    const npcTrainer = {
      jid: `gym:${selected.id}`,
      username: `${selected.leader} · ${selected.name}`,
      badges: [],
      party: selected.team.map((pokemon) => `gym-${selected.id}-${pokemon.pokedexId}`),
      inventory: {},
    };
    const opponentParty = selected.team.map((pokemon) => ({
      _id: `gym-${selected.id}-${pokemon.pokedexId}`,
      id: `gym-${selected.id}-${pokemon.pokedexId}`,
      pokedexId: pokemon.pokedexId,
      name: pokemon.name,
      displayName: pokemon.name,
      level: pokemon.level,
      hp: pokemon.maxHp,
      maxHp: pokemon.maxHp,
      attack: pokemon.attack,
      defense: pokemon.defense,
      speed: pokemon.speed,
      types: pokemon.types,
      moves: pokemon.moves,
      imageUrl: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokemon.pokedexId}.png`,
      frontSpriteUrl: `https://raw.githubusercontent.com/kelin132/animated-pokemon-gifs/master/${pokemon.pokedexId}.gif`,
      backSpriteUrl: `https://raw.githubusercontent.com/kelin132/animated-pokemon-gifs/master/back/${pokemon.pokedexId}.gif`,
      shiny: false,
    }));

    // Use the cached trainer avatar when available; a remote WhatsApp profile
    // lookup unnecessarily delays delivery of the battle link.
    const avatarUrl = trainer.avatarUrl || trainer.profilePic || trainer.image || null;
    const room = await createWebBattleRoom({
      challengerJid: sender,
      challengerName: trainer.username || msg.pushName || sender.split("@")[0],
      challengerAvatarUrl: avatarUrl,
      challengerTrainer: trainer,
      challengerParty: party,
      opponentJid: npcTrainer.jid,
      opponentName: npcTrainer.username,
      opponentAvatarUrl: null,
      opponentTrainer: npcTrainer,
      opponentParty,
      gym: {
        id: selected.id,
        name: selected.name,
        type: selected.type,
        leader: selected.leader,
        badge: selected.badge,
        theme: selected.theme,
        accent: selected.accent,
        background: selected.background,
        music: selected.music,
        rewardCoins: selected.rewardCoins,
        rewardXp: selected.rewardXp,
      },
    });
    const url = webBattleUrl(room._id);
    return sock.sendMessage(jid, { text: `🏟️ *${selected.name.toUpperCase()} READY!*\n\nLeader *${selected.leader}* is waiting with \`${selected.team.length}\` Pokémon.\n\n🎖️ Badge: *${selected.badge}*\n💰 \`$${selected.rewardCoins.toLocaleString()}\` coins · ⭐ \`${selected.rewardXp.toLocaleString()}\` XP\n\nOpen the direct arena link in AIDORU:\n${url}\n\nThe match starts with your party already loaded.` }, { quoted: msg });
  },
};
