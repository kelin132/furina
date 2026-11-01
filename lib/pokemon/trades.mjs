import { randomUUID } from "node:crypto";
import { getDb, getMongoClient } from "../mongo.mjs";
import { normalizeJid } from "../identity.mjs";
import { trainerIdentityQuery, pokemonOwnershipQuery } from "../collectionIdentity.mjs";
import { ObjectId } from "mongodb";

const OFFER_TTL_MS = 10 * 60 * 1000;

function tradeCollection() {
  return getDb().collection("pokemon_trade_offers");
}

export async function createPokemonTradeOffer({
  fromJid,
  toJid,
  offeredPokemonId,
  requestedPokemonId,
  now = new Date(),
}) {
  const id = randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
  const offer = {
    _id: id,
    fromJid: normalizeJid(fromJid),
    toJid: normalizeJid(toJid),
    offeredPokemonId: String(offeredPokemonId),
    requestedPokemonId: String(requestedPokemonId),
    status: "pending",
    createdAt: now,
    expiresAt: new Date(now.getTime() + OFFER_TTL_MS),
  };
  await tradeCollection().insertOne(offer);
  return offer;
}

export async function acceptPokemonTradeOffer(id, recipientJid, now = new Date()) {
  const db = getDb();
  const offer = await tradeCollection().findOne({ _id: String(id).toUpperCase() });
  if (!offer) return { ok: false, missing: true };
  if (offer.toJid !== normalizeJid(recipientJid)) return { ok: false, wrongUser: true };
  if (offer.status !== "pending") return { ok: false, inactive: true };
  if (new Date(offer.expiresAt).getTime() <= now.getTime()) {
    await tradeCollection().updateOne({ _id: offer._id, status: "pending" }, { $set: { status: "expired" } });
    return { ok: false, expired: true };
  }

  const fromJid = offer.fromJid;
  const toJid = offer.toJid;
  const offeredId = ObjectId.createFromHexString(offer.offeredPokemonId);
  const requestedId = ObjectId.createFromHexString(offer.requestedPokemonId);
  const session = getMongoClient().startSession();
  let result = null;

  try {
    await session.withTransaction(async () => {
      result = null;
      const currentOffer = await tradeCollection().findOne(
        { _id: offer._id, status: "pending", expiresAt: { $gt: now } },
        { session },
      );
      if (!currentOffer) throw new Error("OFFER_NOT_ACTIVE");

      const pokemonCollection = db.collection("pokemon_owned");
      const [fromOwnerQuery, toOwnerQuery] = await Promise.all([
        pokemonOwnershipQuery(fromJid),
        pokemonOwnershipQuery(toJid),
      ]);
      const [offered, requested] = await Promise.all([
        pokemonCollection.findOne({ $and: [{ _id: offeredId, inParty: true }, fromOwnerQuery] }, { session }),
        pokemonCollection.findOne({ $and: [{ _id: requestedId, inParty: true }, toOwnerQuery] }, { session }),
      ]);
      if (!offered || !requested) throw new Error("POKEMON_NOT_OWNED");
      const activeRaid = await db.collection("pokemon_coop_raids").findOne(
        { status: "active", "participants.pokemonId": { $in: [offeredId.toString(), requestedId.toString()] } },
        { session },
      );
      if (activeRaid) throw new Error("POKEMON_IN_RAID");
      if (offered.isStarter || requested.isStarter) throw new Error("STARTER_LOCKED");

      const [fromTrainerQuery, toTrainerQuery] = await Promise.all([
        trainerIdentityQuery(fromJid),
        trainerIdentityQuery(toJid),
      ]);
      const trainers = db.collection("pokemon_trainers");
      const [fromTrainer, toTrainer] = await Promise.all([
        trainers.findOne(fromTrainerQuery, { session }),
        trainers.findOne(toTrainerQuery, { session }),
      ]);
      if (!fromTrainer || !toTrainer) throw new Error("TRAINER_NOT_FOUND");
      const offeredKey = offeredId.toString();
      const requestedKey = requestedId.toString();
      if (fromTrainer.keystoneEquippedTo === offeredKey || toTrainer.keystoneEquippedTo === requestedKey) {
        throw new Error("KEYSTONE_EQUIPPED");
      }

      const swappedOffered = await pokemonCollection.updateOne(
        { $and: [{ _id: offeredId, inParty: true }, fromOwnerQuery] },
        { $set: { ownerJid: toJid } },
        { session },
      );
      const swappedRequested = await pokemonCollection.updateOne(
        { $and: [{ _id: requestedId, inParty: true }, toOwnerQuery] },
        { $set: { ownerJid: fromJid } },
        { session },
      );
      if (swappedOffered.modifiedCount !== 1 || swappedRequested.modifiedCount !== 1) {
        throw new Error("OWNERSHIP_CHANGED");
      }

      await trainers.updateMany(
        fromTrainerQuery,
        { $pull: { party: { $in: [offeredKey, requestedKey] }, pc: { $in: [offeredKey, requestedKey] } } },
        { session },
      );
      await trainers.updateMany(
        toTrainerQuery,
        { $pull: { party: { $in: [offeredKey, requestedKey] }, pc: { $in: [offeredKey, requestedKey] } } },
        { session },
      );
      await trainers.updateMany(fromTrainerQuery, { $addToSet: { party: requestedKey } }, { session });
      await trainers.updateMany(toTrainerQuery, { $addToSet: { party: offeredKey } }, { session });
      const completed = await tradeCollection().updateOne(
        { _id: offer._id, status: "pending" },
        { $set: { status: "accepted", acceptedAt: now } },
        { session },
      );
      if (completed.modifiedCount !== 1) throw new Error("OFFER_NOT_ACTIVE");
      result = {
        offeredName: offered.nickname || offered.displayName || offered.name,
        requestedName: requested.nickname || requested.displayName || requested.name,
      };
    });
    return result ? { ok: true, ...result } : { ok: false, inactive: true };
  } catch (error) {
    const code = String(error?.message || "");
    if (code === "OFFER_NOT_ACTIVE") return { ok: false, inactive: true };
    if (code === "POKEMON_NOT_OWNED" || code === "OWNERSHIP_CHANGED") return { ok: false, ownershipChanged: true };
    if (code === "POKEMON_IN_RAID") return { ok: false, inRaid: true };
    if (code === "STARTER_LOCKED") return { ok: false, starter: true };
    if (code === "KEYSTONE_EQUIPPED") return { ok: false, keystone: true };
    if (code === "TRAINER_NOT_FOUND") return { ok: false, trainerMissing: true };
    throw error;
  } finally {
    await session.endSession();
  }
}

export async function declinePokemonTradeOffer(id, recipientJid) {
  const result = await tradeCollection().updateOne(
    {
      _id: String(id).toUpperCase(),
      toJid: normalizeJid(recipientJid),
      status: "pending",
      expiresAt: { $gt: new Date() },
    },
    { $set: { status: "declined", declinedAt: new Date() } },
  );
  return result.modifiedCount === 1;
}
