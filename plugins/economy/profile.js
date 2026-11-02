import { getQuickProfileUser, getUser, requireRegistration } from "./database.js";
import { generateProfileImage, getProfilePic, resolveRole } from "../../lib/profileGen.mjs";
import { getLevelRole, getAllEarnedRoles, getLevelRoleLabel } from "../../lib/levelRoles.mjs";
import { getUser as getCardUser, getUserProfileSummary } from "../cards/db.js";
import { countTrainerPokemon } from "../../lib/pokemon/pokemonDb.mjs";
import { guildSystem } from "../../lib/guildSystem.js";
import { GYMS } from "../../lib/pokemon/gymData.mjs";
import { getTrainer } from "../../lib/pokemon/players.mjs";
import { buildEconomyExternalAdReply } from "../../lib/economyPreview.mjs";

const xpForLevel = (level) => level * 100;

function withTimeout(promise, timeoutMs, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sendProfileFallback({ sock, jid, msg, caption, profilePic, target, externalAdReply }) {
  const contextInfo = externalAdReply ? { externalAdReply } : undefined;
  if (profilePic) {
    try {
      await sock.sendMessage(
        jid,
        { image: { url: profilePic }, caption, contextInfo },
        { quoted: msg }
      );
      return;
    } catch (fallbackError) {
      console.error(
        "[profile] Avatar fallback delivery failed:",
        fallbackError.stack || fallbackError.message || fallbackError
      );
    }
  }

  await sock.sendMessage(
    jid,
    { text: caption, mentions: [target], contextInfo },
    { quoted: msg }
  );
}

function fmtDate(iso) {
  if (!iso) return "Unknown";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return "Unknown"; }
}

function gymAchievementSummary(trainer) {
  const badges = Array.isArray(trainer?.badges) ? trainer.badges.map(String) : [];
  const rewards = trainer?.gymRewards && typeof trainer.gymRewards === "object"
    ? Object.keys(trainer.gymRewards)
    : [];
  const earnedIds = new Set(
    [...badges, ...rewards]
      .map((value) => value.trim().toLowerCase().replace(/-badge$/i, ""))
      .filter(Boolean),
  );
  const earnedGyms = GYMS.filter((gym) => earnedIds.has(gym.id));
  const explicitWins = [trainer?.gymWins, trainer?.gymBattleWins, trainer?.gymVictories]
    .map(Number)
    .find((value) => Number.isFinite(value) && value >= 0);
  const wins = explicitWins ?? earnedGyms.length;
  const nextGym = GYMS.find((gym) => !earnedGyms.some((earned) => earned.id === gym.id));

  return {
    wins,
    completed: earnedGyms.length,
    total: GYMS.length,
    badges: earnedGyms.length ? earnedGyms.map((gym) => gym.badge).join(", ") : "None yet",
    next: nextGym ? nextGym.name : "Circuit complete",
  };
}

export function buildQuickProfileCaption({ name, age, birthday, cards, pokemon, badges, role }) {
  return `*Edit your profile image here:*
https://aidoru.zone.id/profile

❀ *Name* : \`${name}\`
❀ *Age* : \`${age}\`
❀ *Bday* : \`${birthday}\`
❀ *Cards*: \`${cards}\`
❀ *Pokémon*: \`${pokemon}\`
❀ *Badges* : \`${badges}\`
❀ *Role* : \`${role}\``;
}

export function resolveProfileImageSources({ cardUser, user, profilePicFromSocket }) {
  const savedAvatar = [cardUser?.profilePictureUrl, cardUser?.profileImage, cardUser?.avatarUrl]
    .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
  return {
    profilePic: savedAvatar || profilePicFromSocket || null,
    profileBackground: user?.profileBackground || null,
  };
}

export default {
  name: "profile",
  description: "View your economy profile card",
  category: "economy",
  usage: ".profile [@user]",
  aliases: ["me", "acc", "account", "p"],
  cooldown: 5,

  async run({ sock, msg, sender, cmd, isOwner, isMod, isStaff }) {
    const jid = msg.key.remoteJid;

    // Check for @mention or quoted/replied message author
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo;
    const mentioned   = contextInfo?.mentionedJid?.[0];
    const quotedUser  = contextInfo?.participant;

    const target = mentioned || quotedUser || sender;

    // `.p` is the fast self-profile shortcut. The generated image does not
    // use guild/badge/trainer details, so avoid those extra database reads.
    const isQuickProfile = cmd === "p";
    if (target === sender && !isQuickProfile && !await requireRegistration(sock, msg, sender)) return;

    // `.p` uses narrow, read-only snapshots and starts all independent reads
    // together. The full profile keeps its richer card/trainer/guild data.
    const cardUserPromise = isQuickProfile ? getUserProfileSummary(target) : getCardUser(target);
    const profilePicPromise = isQuickProfile
      ? getProfilePic(sock, target).catch(() => null)
      : withTimeout(getProfilePic(sock, target), 2500);
    const [cardUser, user, profilePicFromSocket, pokemonCount, guild, trainer] = await Promise.all([
      cardUserPromise,
      isQuickProfile ? getQuickProfileUser(target) : getUser(target),
      isQuickProfile ? Promise.resolve(null) : profilePicPromise,
      countTrainerPokemon(target),
      isQuickProfile ? Promise.resolve(null) : withTimeout(guildSystem.getUserPrimaryGuild(target), 2500),
      isQuickProfile ? withTimeout(getTrainer(target), 1500) : withTimeout(getTrainer(target), 2500),
    ]);
    if (target === sender && isQuickProfile && !await requireRegistration(sock, msg, sender, user)) return;
    const savedAvatar = [cardUser?.profilePictureUrl, cardUser?.profileImage, cardUser?.avatarUrl]
      .find((value) => typeof value === "string" && /^https?:\/\//i.test(value));
    const quickSocketAvatar = isQuickProfile && !savedAvatar
      ? await withTimeout(profilePicPromise, 1500)
      : profilePicFromSocket;
    const { profilePic, profileBackground } = resolveProfileImageSources({
      cardUser,
      user,
      profilePicFromSocket: quickSocketAvatar,
    });

    const tag   = target.split("@")[0].split(":")[0];
    const level = user.level ?? 1;
    const xp    = user.xp    ?? 0;
    const registeredName = String(user.name || "User").trim() || "User";
    const cardsOwned = Array.isArray(cardUser?.cards)
      ? cardUser.cards.length
      : (cardUser?.cardsCount ?? cardUser?.totalCards ?? 0);
    const history = Array.isArray(user.history) ? user.history : [];
    const gameTypes = new Set(["bet", "coinflip", "slots", "roulette", "scratch", "gamble"]);
    const casinoTypes = new Set(["slots", "roulette", "scratch", "gamble"]);
    const gamesPlayed = history.filter((entry) => gameTypes.has(entry.type)).length;
    const casinoGames = history.filter((entry) => casinoTypes.has(entry.type)).length;

    const role = resolveRole({
      isOwner:    target === sender ? isOwner  : false,
      isMod:      target === sender ? isMod    : (user.staffLevel >= 1),
      isStaff:    target === sender ? isStaff  : (user.staffLevel >= 2),
      isPremium:  user.isPremium,
      staffLevel: user.staffLevel ?? 0,
    });

    const levelRole   = getLevelRole(level);
    const earnedRoles = getAllEarnedRoles(level);
    const roleLabel   = getLevelRoleLabel(level);
    const guildName   = String(guild?.name || user.guildName || user.guild || "None").trim() || "None";
    const joinedDate  = fmtDate(user.registeredAt);
    const roleShort = {
      Owner: "OWNER",
      Moderator: "MOD",
      Staff: "STAFF",
      Premium: "PREMIUM",
      Member: "MEMBER",
    }[role] || role.toUpperCase();
    const gymProgress = gymAchievementSummary(trainer);

    const lastDaily       = user.lastDaily ?? 0;
    const hoursSinceDaily = (Date.now() - lastDaily) / 36e5;
    const streak          = hoursSinceDaily < 48 ? (user.streak ?? 1) : 0;

    const daysActive = user.registeredAt
      ? Math.max(0, Math.floor((Date.now() - new Date(user.registeredAt).getTime()) / 86400000))
      : 0;

    const reach = Number.isFinite(Number(user.reach)) ? Number(user.reach) : daysActive;
    const displayName = registeredName;
    const profileAge = user.age === null || user.age === undefined || user.age === "" ? "N/A" : user.age;
    const profileBirthday = String(user.birthday || "N/A").trim() || "N/A";
    const profileBio = String(user.bio || "N/A").trim() || "N/A";
    const profileCards = Number.isFinite(Number(cardsOwned))
      ? Number(cardsOwned).toLocaleString()
      : "N/A";
    const profilePokemon = Number.isFinite(Number(pokemonCount))
      ? Number(pokemonCount).toLocaleString()
      : "N/A";
    const profileBadges = Number.isFinite(Number(gymProgress.completed))
      ? gymProgress.completed
      : "N/A";
    const caption = isQuickProfile
      ? buildQuickProfileCaption({
        name: displayName,
        age: profileAge,
        birthday: profileBirthday,
        cards: profileCards,
        pokemon: profilePokemon,
        badges: profileBadges,
        role,
      })
      :
`╭━━━〔 🌸 𝗣𝗥𝗢𝗙𝗜𝗟𝗘 〕━━━╮
│ ❀ Name : \`${displayName}\`
│ ❀ Age : \`${profileAge}\`
│ ❀ Bday : \`${profileBirthday}\`
│ ❀ Bio : \`${profileBio}\`
│ ❀ Cards : \`${profileCards}\`
│ ❀ Pokémon : \`${profilePokemon}\`
│ ❀ Badges : \`${profileBadges}\`
│ ❀ Role : \`${role}\`
│
│  *view and edit your profile image*
│ *here:*
│  *https://aidoru.zone.id/profile*
╰━━━━━━━━━━━━━━━━━━━━━━╯`;

    let imgBuffer;
    const externalAdReply = cmd === "profile"
      ? await buildEconomyExternalAdReply("profile")
      : null;
    try {
      imgBuffer = await generateProfileImage({
        username:     registeredName,
        tag,
        role,
        level,
        xp,
        xpTarget:     xpForLevel(level),
        reach,
        wallet:       user.money    ?? 0,
        bank:         user.bank     ?? 0,
        bio:          user.bio      || "No bio set.",
        guild:        guildName,
        joined:       joinedDate,
        streak,
        items:        user.inventory?.length ?? 0,
        transactions: user.history?.length   ?? 0,
        profileImage: profilePic,
        profileBackground,
        profileFrame: user.profileFrame || null,
        levelRole,
        earnedRoles,
        daysActive,
        cards: cardsOwned,
        games: gamesPlayed,
        pokemon: pokemonCount,
        diamonds: user.diamonds ?? 0,
      });

    } catch (err) {
      console.error(
        "[profile] Canvas generation failed:",
        err.stack || err.message || err
      );
      await sendProfileFallback({ sock, jid, msg, caption, profilePic, target, externalAdReply });
      return;
    }

    try {
      await sock.sendMessage(
        jid,
        {
          image: imgBuffer,
          caption,
          contextInfo: externalAdReply ? { externalAdReply } : undefined,
        },
        { quoted: msg },
      );
    } catch (err) {
      console.error(
        "[profile] Canvas image delivery failed:",
        err.stack || err.message || err
      );
      await sendProfileFallback({ sock, jid, msg, caption, profilePic, target, externalAdReply });
    }
  },
};
