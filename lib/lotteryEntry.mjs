import { randomUUID } from "node:crypto";
import { identityVariants as variants, resolveAccountIdentity as resolveLotteryIdentity } from "./accountIdentity.mjs";
export { resolveLotteryIdentity };

export const LOTTERY_ENTRY_LIMIT = 16;

export function findIdentityTicket(tickets, values, discordIds = []) {
  const ids = new Set(values.map(String));
  return (Array.isArray(tickets) ? tickets : []).find(ticket =>
    ids.has(String(ticket.userId || "").trim().replace(/:\d+@/, "@").replace(/@c\.us$/i, "@s.whatsapp.net"))
    || (ticket.accountIds || []).some(id => ids.has(String(id)))
    || discordIds.includes(String(ticket.discordId || "")));
}

export function findLotteryTicket(tickets, sender, discordId = null) {
  return findIdentityTicket(tickets, [...variants(sender), ...(discordId ? [`discord:${discordId}`] : [])], discordId ? [String(discordId)] : []);
}

export async function findAccountLotteryTicket(db, tickets, sender, discordId = null) {
  const identity = await resolveLotteryIdentity(db, sender, discordId);
  return findIdentityTicket(tickets, identity.ids, identity.discordIds);
}

export async function getLotteryRound(db, baseJackpot) {
  try {
    await db.collection("lottery").updateOne({ _id: "current" }, {
      $setOnInsert: {
        tickets: [], totalTickets: 0, jackpot: baseJackpot, baseJackpot,
        createdAt: new Date(), roundId: randomUUID(),
      },
    }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error; // Concurrent first-round initialization.
  }
  return db.collection("lottery").findOne({ _id: "current" });
}

function roundFilter(lot) {
  return lot.roundId ? { roundId: lot.roundId } : { createdAt: lot.createdAt ?? null };
}

export async function purchaseLotteryTicket({ db, lot, sender, discordId = null, name, groupId, price, maxEntries = LOTTERY_ENTRY_LIMIT }) {
  const identity = await resolveLotteryIdentity(db, sender, discordId);
  if (findIdentityTicket(lot.tickets, identity.ids, identity.discordIds)) return { ok: false, reason: "duplicate" };
  if (lot.drawing || lot.totalTickets >= maxEntries) return { ok: false, reason: "drawing" };
  const users = db.collection("users");
  const debit = await users.updateOne(
    { _id: identity.accountId, money: { $gte: price } },
    { $inc: { money: -price } },
  );
  if (debit.modifiedCount !== 1) return { ok: false, reason: "funds" };

  const purchaseId = randomUUID();
  const ticket = {
    userId: String(identity.accountId), accountIds: identity.ids, purchaseId, name: name || "User", count: 1,
    ...(identity.discordIds[0] ? { discordId: identity.discordIds[0] } : {}),
    ...(String(groupId).endsWith("@g.us") ? { groupId } : {}),
  };
  // This single-document condition protects both platforms, even if they buy
  // simultaneously. Never replace the whole tickets array from a stale read.
  let entry;
  try {
    entry = await db.collection("lottery").updateOne({
      _id: "current", ...roundFilter(lot), drawing: { $ne: true },
      totalTickets: { $lt: maxEntries },
      tickets: { $not: { $elemMatch: { $or: [
        { userId: { $in: identity.ids } },
        { accountIds: { $in: identity.ids } },
        { discordId: { $in: identity.discordIds } },
      ] } } },
    }, { $push: { tickets: ticket }, $inc: { totalTickets: 1, jackpot: price } });
  } catch (error) {
    // A timed-out write may have committed. Do not refund a potentially valid
    // ticket (or retry charging) when Mongo cannot confirm the outcome.
    const current = await db.collection("lottery").findOne({ _id: "current" }).catch(() => null);
    if (!current?.tickets?.some(item => item.purchaseId === purchaseId)) {
      throw new Error("Lottery purchase status is uncertain. Check your ticket and wallet before retrying.", { cause: error });
    }
    entry = { modifiedCount: 1 };
  }
  if (entry.modifiedCount !== 1) {
    await users.updateOne({ _id: identity.accountId }, { $inc: { money: price } });
    const current = await db.collection("lottery").findOne({ _id: "current" });
    return { ok: false, reason: findIdentityTicket(current?.tickets, identity.ids, identity.discordIds) ? "duplicate" : "drawing" };
  }
  return { ok: true, ticket, accountId: identity.accountId };
}

// Purchases and both draw implementations honor this same lock.
export async function claimLotteryDraw(db, lot) {
  const drawToken = randomUUID();
  const claim = await db.collection("lottery").updateOne({
    _id: "current", ...roundFilter(lot), totalTickets: lot.totalTickets, drawing: { $ne: true },
  }, { $set: { drawing: true, drawToken } });
  return claim.modifiedCount === 1 ? drawToken : null;
}
