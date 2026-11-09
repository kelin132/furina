import { randomUUID } from "node:crypto";
import { getDb } from "./mongo.mjs";

const ROOM_TTL_MS = 10 * 60 * 1000;
const FINISHED_ROOM_TTL_MS = 20_000;
const roomCreationInFlight = new Map();

function text(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roomCodeFromId(id) {
  return String(id).replace(/[^a-z0-9]/gi, "").slice(-6).toUpperCase();
}

function identityVariants(value) {
  const raw = text(value).trim();
  if (!raw) return [];
  const withoutDevice = raw.replace(/:\d+(?=@)/, "");
  const bare = withoutDevice.split("@")[0] || withoutDevice;
  return [...new Set([raw, withoutDevice, bare, `${bare}@s.whatsapp.net`].filter(Boolean))];
}

function canonicalIdentity(value) {
  const raw = text(value).trim().replace(/:\d+(?=@)/, "");
  return (raw.split("@")[0] || raw).toLowerCase();
}

function pairKey(first, second) {
  return [canonicalIdentity(first), canonicalIdentity(second)].filter(Boolean).sort().join("::");
}

function snapshotMove(move = {}) {
  const desc = typeof move.desc === "string" ? move.desc : null;
  return {
    name: text(move.name, "Unknown move"),
    type: text(move.type, "normal").toLowerCase(),
    power: number(move.power),
    accuracy: number(move.accuracy, 100),
    pp: number(move.pp),
    priority: number(move.priority),
    ...(desc ? { desc } : {}),
  };
}

function snapshotPokemon(pokemon = {}) {
  const id = text(pokemon._id ?? pokemon.id);
  const pokedexId = number(pokemon.pokedexId);
  const imageUrl = text(
    pokemon.imageUrl,
    pokedexId > 0
      ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${pokedexId}.png`
      : "",
  );
  const hp = Math.max(0, number(pokemon.hp));
  return {
    id,
    pokedexId,
    name: text(pokemon.name, "Unknown"),
    displayName: text(pokemon.displayName ?? pokemon.nickname ?? pokemon.name, "Unknown"),
    level: Math.max(1, number(pokemon.level, 1)),
    hp,
    maxHp: Math.max(1, number(pokemon.maxHp, 1)),
    attack: Math.max(1, number(pokemon.attack, 10)),
    defense: Math.max(1, number(pokemon.defense, 10)),
    speed: Math.max(1, number(pokemon.speed, 10)),
    types: Array.isArray(pokemon.types) ? pokemon.types.map((type) => text(type).toLowerCase()) : [text(pokemon.primaryType, "normal").toLowerCase()],
    imageUrl,
    frontSpriteUrl: text(pokemon.frontSpriteUrl, imageUrl),
    backSpriteUrl: text(pokemon.backSpriteUrl ?? pokemon.backImageUrl, imageUrl),
    shiny: Boolean(pokemon.shiny),
    fainted: hp <= 0,
    moves: Array.isArray(pokemon.moves) ? pokemon.moves.map(snapshotMove) : [],
  };
}

function orderedParty(trainer, party) {
  const docs = Array.isArray(party) ? party : [];
  const byId = new Map(docs.map((pokemon) => [text(pokemon._id ?? pokemon.id), pokemon]));
  const ordered = [];
  for (const id of Array.isArray(trainer?.party) ? trainer.party : []) {
    const pokemon = byId.get(text(id));
    if (pokemon && !ordered.includes(pokemon)) ordered.push(pokemon);
  }
  for (const pokemon of docs) {
    if (!ordered.includes(pokemon)) ordered.push(pokemon);
  }
  const leadId = text(trainer?.leadPokemonId);
  const leadIndex = leadId ? ordered.findIndex((pokemon) => text(pokemon._id ?? pokemon.id) === leadId && number(pokemon.hp) > 0) : -1;
  if (leadIndex > 0) {
    const [lead] = ordered.splice(leadIndex, 1);
    ordered.unshift(lead);
  }
  return ordered;
}

function trainerSnapshot({ trainer, party, jid, name, avatarUrl }) {
  const partyDocs = orderedParty(trainer, party).slice(0, 6);
  return {
    id: jid,
    name: text(name, jid.split("@")[0] || "Trainer"),
    avatarUrl: avatarUrl || null,
    trainerSpriteUrl: null,
    ready: false,
    party: partyDocs.map(snapshotPokemon),
    activeIndex: 0,
    inventory: Object.fromEntries(Object.entries(trainer?.inventory || {}).map(([item, qty]) => [item, number(qty)])),
  };
}

/**
 * Create a durable website room for a WhatsApp challenge. The opponent is
 * invited by JID and joins the same room link with their own authenticated
 * website session; all party members are snapshotted in bot order.
 */
export async function createWebBattleRoom(input) {
  const requestKey = pairKey(input.challengerJid, input.opponentJid);
  const existingRequest = roomCreationInFlight.get(requestKey);
  if (existingRequest) return existingRequest;
  const request = createWebBattleRoomInternal(input);
  roomCreationInFlight.set(requestKey, request);
  try {
    return await request;
  } finally {
    if (roomCreationInFlight.get(requestKey) === request) roomCreationInFlight.delete(requestKey);
  }
}

async function createWebBattleRoomInternal({
  challengerJid,
  challengerName,
  challengerAvatarUrl = null,
  challengerTrainer,
  challengerParty,
  opponentJid,
  opponentName,
  opponentAvatarUrl = null,
  opponentTrainer,
  opponentParty,
  gym = null,
}) {
  const db = getDb();
  const rooms = db.collection("web_battle_rooms");
  const now = new Date();
  const finishedCutoff = new Date(now.getTime() - FINISHED_ROOM_TTL_MS);
  // Clean expired rooms asynchronously so a repeat challenge can't reopen a
  // finished room left behind by an earlier build.
  void rooms.deleteMany({
    $or: [
      { expiresAt: { $lte: now } },
      {
        status: "finished",
        $or: [
          { finishedAt: { $lte: finishedCutoff } },
          {
            finishedAt: { $exists: false },
            lastActionAt: { $lte: finishedCutoff },
          },
        ],
      },
    ],
  }).catch(() => {});
  const hasOpponent = Boolean(opponentTrainer && Array.isArray(opponentParty));
  const challengerIds = identityVariants(challengerJid);
  const opponentIds = identityVariants(opponentJid);
  const key = pairKey(challengerJid, opponentJid);
  const pairFilter = {
    status: { $in: ["waiting", "active"] },
    $or: [
      { "challenger.id": { $in: challengerIds }, invitedOpponentId: { $in: opponentIds } },
      { "challenger.id": { $in: opponentIds }, invitedOpponentId: { $in: challengerIds } },
      { pairKey: key },
    ],
  };
  const matches = await rooms.find(pairFilter).sort({ createdAt: 1 }).toArray();
  const existing = matches[0] || null;
  if (matches.length > 1) {
    await rooms.deleteMany({ _id: { $in: matches.slice(1).map((room) => room._id) } });
  }
  if (existing) {
    if (!existing.code) existing.code = roomCodeFromId(existing._id);
    if (!existing.opponent && hasOpponent) {
      const opponentSnapshot = trainerSnapshot({
        trainer: opponentTrainer,
        party: opponentParty,
        jid: opponentJid,
        name: opponentName,
        avatarUrl: opponentAvatarUrl,
      });
      opponentSnapshot.ready = true;
      const updated = {
        ...existing,
        code: existing.code,
        status: "active",
        opponent: opponentSnapshot,
        invitedOpponentId: opponentJid || existing.invitedOpponentId || null,
        pairKey: key,
        autoStart: true,
        challenger: { ...existing.challenger, ready: true },
        turn: "challenger",
        round: 1,
        combatLog: [
          ...(Array.isArray(existing.combatLog) ? existing.combatLog : []),
          `${opponentSnapshot.name} joined the room. The arena is live.`,
        ],
        lastActionAt: now,
        expiresAt: new Date(now.getTime() + ROOM_TTL_MS),
        version: Number(existing.version || 0) + 1,
      };
      await rooms.replaceOne({ _id: existing._id }, updated);
      return updated;
    }
    await rooms.updateOne(
      { _id: existing._id },
      { $set: { code: existing.code, pairKey: existing.pairKey || key } },
    );
    return { ...existing, code: existing.code, pairKey: existing.pairKey || key };
  }
  const challengerSnapshot = trainerSnapshot({
    trainer: challengerTrainer,
    party: challengerParty,
    jid: challengerJid,
    name: challengerName,
    avatarUrl: challengerAvatarUrl,
  });
  const opponentSnapshot = hasOpponent
    ? trainerSnapshot({
        trainer: opponentTrainer,
        party: opponentParty,
        jid: opponentJid,
        name: opponentName,
        avatarUrl: opponentAvatarUrl,
      })
    : null;
  if (hasOpponent) {
    challengerSnapshot.ready = true;
    opponentSnapshot.ready = true;
  }
  const roomId = `battle-${randomUUID()}`;
  const room = {
    _id: roomId,
    code: roomCodeFromId(roomId),
    status: hasOpponent ? "active" : "waiting",
    challenger: challengerSnapshot,
    opponent: opponentSnapshot,
    invitedOpponentId: opponentJid || null,
    pairKey: key,
    gym,
    rewardGrantedAt: null,
    autoStart: true,
    spectatorIds: [],
    turn: hasOpponent ? "challenger" : null,
    forcedSwitch: null,
    round: hasOpponent ? 1 : 0,
    winnerId: null,
    combatLog: [
      hasOpponent
        ? "Room opened from a WhatsApp challenge. Both trainers are loaded and the arena is live."
        : "Room opened from a WhatsApp challenge. Waiting for the challenged trainer to join.",
    ],
    version: 1,
    createdAt: now,
    lastActionAt: now,
    expiresAt: new Date(now.getTime() + ROOM_TTL_MS),
  };
  try {
    await rooms.insertOne(room);
  } catch (error) {
    if (error?.code === 11000) {
      const concurrent = await rooms.findOne({ _id: room._id });
      if (concurrent) return concurrent;
    }
    throw error;
  }
  return room;
}

export function webBattleUrl(roomId) {
  const base = "https://aidoru.zone.id";
  const normalizedBase = base.replace(/\/+$/, "").replace(/\/battle$/i, "");
  return `${normalizedBase}/battle/${encodeURIComponent(roomId)}`;
}
