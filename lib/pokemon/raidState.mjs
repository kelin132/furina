import { getDb, getMongoClient } from "../mongo.mjs";
import { calcBattleDamage } from "./gameLogic.mjs";
import { getWeeklyBattleRule } from "./seasonal.mjs";
import { trainerIdentityQuery } from "../collectionIdentity.mjs";

const RAID_TTL_MS = 45 * 60 * 1000;
const RAID_PARTICIPANT_LIMIT = 4;

function collection() {
  return getDb().collection("pokemon_coop_raids");
}

export async function getActivePokemonRaid(chatId, now = Date.now()) {
  const raid = await collection().findOne({ _id: String(chatId), status: "active" });
  if (!raid) return null;
  if (now - new Date(raid.createdAt).getTime() > RAID_TTL_MS) {
    await collection().updateOne(
      { _id: raid._id, status: "active" },
      { $set: { status: "expired", expiredAt: new Date(now) }, $inc: { version: 1 } },
    );
    return null;
  }
  return raid;
}

export async function startPokemonRaid(chatId, destination, boss) {
  const current = await getActivePokemonRaid(chatId);
  if (current) return { ok: false, existing: current };
  const now = new Date();
  const raid = {
    _id: String(chatId),
    chatId: String(chatId),
    place: destination.name,
    boss: {
      name: boss.displayName || boss.name,
      imageUrl: boss.imageUrl,
      level: boss.level,
      hp: boss.hp,
      maxHp: boss.maxHp,
      attack: boss.attack,
      defense: boss.defense,
      speed: boss.speed,
      types: boss.types || [],
      primaryType: boss.primaryType,
      moves: boss.moves || [],
      shieldCharges: boss.shieldCharges || 0,
      maxShieldCharges: boss.maxShieldCharges || 0,
      isFusionBoss: true,
    },
    participants: [],
    status: "active",
    rewardClaims: [],
    weeklyRuleId: getWeeklyBattleRule().id,
    version: 0,
    createdAt: now,
  };
  const existing = await collection().findOne({ _id: raid._id }, { projection: { status: 1 } });
  try {
    if (existing) {
      const result = await collection().replaceOne(
        { _id: raid._id, status: { $ne: "active" } },
        raid,
      );
      if (result.modifiedCount !== 1) {
        const active = await getActivePokemonRaid(chatId);
        if (active) return { ok: false, existing: active };
        return { ok: false, busy: true };
      }
    } else {
      await collection().insertOne(raid);
    }
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const active = await getActivePokemonRaid(chatId);
    if (active) return { ok: false, existing: active };
    return { ok: false, busy: true };
  }
  return { ok: true, raid };
}

export async function joinPokemonRaid(chatId, participant) {
  const jid = String(participant.jid);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const raid = await getActivePokemonRaid(chatId);
    if (!raid) return { ok: false, missing: true };
    const existingIndex = raid.participants.findIndex((entry) => entry.jid === jid);
    if (existingIndex >= 0 && raid.participants[existingIndex].hp > 0) {
      return { ok: false, alreadyJoined: true, raid };
    }
    if (existingIndex < 0 && raid.participants.length >= RAID_PARTICIPANT_LIMIT) {
      return { ok: false, full: true, raid };
    }
    const nextParticipant = {
      jid,
      name: String(participant.name || "Trainer"),
      pokemonId: String(participant.pokemonId),
      pokemonName: String(participant.pokemonName),
      level: Number(participant.pokemon.level || 1),
      hp: Number(participant.pokemon.hp || 0),
      maxHp: Number(participant.pokemon.maxHp || 1),
      attack: Number(participant.pokemon.attack || 1),
      defense: Number(participant.pokemon.defense || 1),
      speed: Number(participant.pokemon.speed || 1),
      types: participant.pokemon.types || [],
      primaryType: participant.pokemon.primaryType,
      moves: participant.pokemon.moves || [],
      lastAttackAt: 0,
      damageDealt: 0,
    };
    const participants = [...raid.participants];
    if (existingIndex >= 0) participants[existingIndex] = nextParticipant;
    else participants.push(nextParticipant);

    const result = await collection().updateOne(
      { _id: raid._id, status: "active", version: raid.version },
      { $set: { participants }, $inc: { version: 1 } },
    );
    if (result.modifiedCount === 1) return { ok: true, raid: { ...raid, participants } };
  }
  return { ok: false, busy: true };
}

export async function attackPokemonRaid(chatId, jid, moveIndex, now = Date.now(), random = Math.random) {
  const trainerJid = String(jid);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const raid = await getActivePokemonRaid(chatId, now);
    if (!raid) return { ok: false, missing: true };
    const participantIndex = raid.participants.findIndex((entry) => entry.jid === trainerJid);
    if (participantIndex < 0) return { ok: false, notJoined: true };
    const participant = raid.participants[participantIndex];
    if (participant.hp <= 0) return { ok: false, fainted: true };
    const waitMs = 30_000 - (now - Number(participant.lastAttackAt || 0));
    if (waitMs > 0) return { ok: false, cooldown: waitMs };
    const move = participant.moves[moveIndex];
    if (!move) return { ok: false, invalidMove: true, moveCount: participant.moves.length };

    const baseDamage = calcBattleDamage(participant, raid.boss, move, { weeklyRuleId: raid.weeklyRuleId });
    let damage = Math.max(1, baseDamage);
    let shieldCharges = Number(raid.boss.shieldCharges || 0);
    if (shieldCharges > 0) {
      damage = Math.max(1, Math.floor(damage * 0.45));
      shieldCharges -= 1;
    }
    const bossHp = Math.max(0, Number(raid.boss.hp || 0) - damage);
    const survivingBoss = bossHp > 0;
    let counterMove = null;
    let counterDamage = 0;
    let playerHp = participant.hp;
    if (survivingBoss && raid.boss.moves.length) {
      counterMove = raid.boss.moves[Math.floor(random() * raid.boss.moves.length)];
      counterDamage = calcBattleDamage(raid.boss, participant, counterMove, { weeklyRuleId: raid.weeklyRuleId });
      playerHp = Math.max(0, playerHp - Math.max(1, counterDamage));
    }

    const participants = [...raid.participants];
    participants[participantIndex] = {
      ...participant,
      hp: playerHp,
      lastAttackAt: now,
      damageDealt: Number(participant.damageDealt || 0) + damage,
    };
    const nextBoss = { ...raid.boss, hp: bossHp, shieldCharges };
    const update = {
      $set: {
        boss: nextBoss,
        participants,
        status: survivingBoss ? "active" : "cleared",
        ...(survivingBoss ? {} : { completedAt: new Date(now) }),
      },
      $inc: { version: 1 },
    };
    const result = await collection().updateOne(
      { _id: raid._id, status: "active", version: raid.version },
      update,
    );
    if (result.modifiedCount !== 1) continue;

    return {
      ok: true,
      raid: { ...raid, boss: nextBoss, participants, status: survivingBoss ? "active" : "cleared" },
      damage,
      counterMove,
      counterDamage,
      playerHp,
      defeated: !survivingBoss,
    };
  }
  return { ok: false, busy: true };
}

export async function claimPokemonRaidReward(raidId, jid, now = new Date()) {
  const trainerJid = String(jid);
  const session = getMongoClient().startSession();
  let claimed = false;
  try {
    await session.withTransaction(async () => {
      claimed = false;
      const eligibleRaid = await collection().findOne(
        {
          _id: String(raidId),
          status: "cleared",
          "participants.jid": trainerJid,
          rewardClaims: { $ne: trainerJid },
        },
        { session },
      );
      if (!eligibleRaid) return;

      const identityQuery = await trainerIdentityQuery(trainerJid);
      const cutoff = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      const trainerResult = await getDb().collection("pokemon_trainers").updateOne(
        {
          $and: [
            identityQuery,
            {
              $or: [
                { lastRaidRewardAt: { $exists: false } },
                { lastRaidRewardAt: { $lte: cutoff } },
              ],
            },
          ],
        },
        { $set: { lastRaidRewardAt: now, lastRaidRewardRaidId: String(raidId) } },
        { session },
      );
      if (trainerResult.modifiedCount !== 1) return;

      const result = await collection().updateOne(
        {
          _id: String(raidId),
          status: "cleared",
          "participants.jid": trainerJid,
          rewardClaims: { $ne: trainerJid },
        },
        { $addToSet: { rewardClaims: trainerJid } },
        { session },
      );
      if (result.modifiedCount !== 1) throw new Error("RAID_REWARD_ALREADY_CLAIMED");
      claimed = true;
    });
    return claimed;
  } catch (error) {
    if (error?.message === "RAID_REWARD_ALREADY_CLAIMED") return false;
    throw error;
  } finally {
    await session.endSession();
  }
}
