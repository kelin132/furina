/**
 * KELIN MD — Tax Scheduler
 *
 * Automatic collection is opt-in and can be controlled with `.tax on/off`.
 * When enabled, every registered user is taxed every 48 hours. Collection
 * can also be run manually with `.tax collect`.
 *
 * The opt-in state and schedule are persisted in the `config` collection so
 * the command and scheduler can run in different bot processes.
 */

import { getDb } from "./mongo.mjs";
import { log }   from "./logger.mjs";
import {
  HIGH_WEALTH_TAX_RATE,
  STANDARD_TAX_RATE,
  TAX_INTERVAL_MS,
  TAX_WEALTH_THRESHOLD,
  nextTaxRunAt,
  wealthTaxExpression,
} from "./taxRules.mjs";

const CONFIG_ID        = "taxScheduler";
const LOCK_ID          = "taxCollectionLock";
const LOCK_DURATION_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 60 * 1000;

let _taxTimer = null;
let _taxCollectionPromise = null;
let _scheduledCheckPromise = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

async function readTaxConfig() {
  return getDb().collection("config").findOne({ _id: CONFIG_ID });
}

export async function getTaxAutomationStatus() {
  const config = await readTaxConfig();
  return {
    enabled: config?.enabled === true,
    lastRun: Number(config?.lastRun) || null,
    nextRunAt: nextTaxRunAt(config),
  };
}

export async function setTaxAutomationEnabled(enabled) {
  const db = getDb();
  const config = await readTaxConfig();
  const shouldEnable = Boolean(enabled);

  if (shouldEnable && config?.enabled === true) {
    return getTaxAutomationStatus();
  }

  const now = Date.now();
  await db.collection("config").updateOne(
    { _id: CONFIG_ID },
    {
      $set: shouldEnable
        ? { enabled: true, enabledAt: now, nextRunAt: now + TAX_INTERVAL_MS }
        : { enabled: false, enabledAt: null, nextRunAt: null },
    },
    { upsert: true },
  );
  return getTaxAutomationStatus();
}

async function acquireTaxLock(db, now) {
  const config = db.collection("config");
  try {
    await config.updateOne(
      { _id: LOCK_ID },
      { $setOnInsert: { leaseUntil: 0 } },
      { upsert: true },
    );
  } catch (error) {
    // Another process may create the lock document between the upsert and
    // this process's attempt. The duplicate-key race is safe to continue past.
    if (error?.code !== 11000) throw error;
  }

  const token = `${process.pid}:${now}:${Math.random().toString(36).slice(2)}`;
  const result = await config.updateOne(
    {
      _id: LOCK_ID,
      $or: [
        { leaseUntil: { $lte: now } },
        { leaseUntil: { $exists: false } },
      ],
    },
    { $set: { leaseUntil: now + LOCK_DURATION_MS, token } },
  );
  return result.matchedCount === 1 ? token : null;
}

async function releaseTaxLock(db, token) {
  await db.collection("config").updateOne(
    { _id: LOCK_ID, token },
    { $set: { leaseUntil: 0 }, $unset: { token: "" } },
  );
}

// ── Core tax collection ───────────────────────────────────────────────────────

async function collectTax({ automatic = false } = {}) {
  if (_taxCollectionPromise) return _taxCollectionPromise;

  const run = (async () => {
  const now = Date.now();
  log(
    "info",
    `[tax] 🏛️  Collecting progressive ${STANDARD_TAX_RATE * 100}%/${HIGH_WEALTH_TAX_RATE * 100}% tax ` +
    `(20% at $${fmt(TAX_WEALTH_THRESHOLD)} total wealth or for the top two leaderboard users)...`,
  );

  try {
    const db = await getDb();
    if (automatic && (await readTaxConfig())?.enabled !== true) {
      return { ok: false, skipped: true };
    }

    const lockToken = await acquireTaxLock(db, now);
    if (!lockToken) {
      return { ok: false, busy: true };
    }

    try {
    const wealth = {
      $add: [
        { $ifNull: ["$money", 0] },
        { $ifNull: ["$bank", 0] },
      ],
    };
    const topTwoUsers = await db.collection("users").aggregate([
      { $match: { registered: true } },
      {
        $project: {
          _id: 1,
          wealth: {
            $add: [
              { $ifNull: ["$money", 0] },
              { $ifNull: ["$bank", 0] },
            ],
          },
        },
      },
      { $sort: { wealth: -1, _id: 1 } },
      { $limit: 2 },
    ]).toArray();
    const topTwoIds = topTwoUsers.map(({ _id }) => _id);
    const topTwoMembership = { $in: ["$_id", topTwoIds] };
    const highTaxCondition = {
      $or: [
        { $gte: [wealth, TAX_WEALTH_THRESHOLD] },
        topTwoMembership,
      ],
    };
    const taxRate = wealthTaxExpression(topTwoIds);
    const afterTaxMoney = {
      $floor: {
        $multiply: [
          { $ifNull: ["$money", 0] },
          { $subtract: [1, taxRate] },
        ],
      },
    };
    const afterTaxBank = {
      $floor: {
        $multiply: [
          { $ifNull: ["$bank", 0] },
          { $subtract: [1, taxRate] },
        ],
      },
    };

    // Preview each bracket before changing any balances.
    const agg = await db.collection("users").aggregate([
      { $match: { registered: true } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          highWealthCount: {
            $sum: { $cond: [highTaxCondition, 1, 0] },
          },
          taxedMoney: {
            $sum: { $subtract: [{ $ifNull: ["$money", 0] }, afterTaxMoney] },
          },
          taxedBank: {
            $sum: { $subtract: [{ $ifNull: ["$bank", 0] }, afterTaxBank] },
          },
        },
      },
    ]).toArray();

    const { count = 0, highWealthCount = 0, taxedMoney = 0, taxedBank = 0 } = agg[0] ?? {};

    // Recheck the persisted switch immediately before changing balances. This
    // lets `.tax off` in another worker cancel a due-but-not-yet-applied run.
    if (automatic && (await readTaxConfig())?.enabled !== true) {
      return { ok: false, skipped: true };
    }

    // The rate expression is evaluated against each user's pre-tax wallet + bank.
    const result = await db.collection("users").updateMany(
      { registered: true },
      [{ $set: {
        money: afterTaxMoney,
        bank: afterTaxBank,
        totalWealth: { $add: [afterTaxMoney, afterTaxBank] },
      }}]
    );

    await db.collection("config").updateOne(
      { _id: CONFIG_ID },
      { $set: { lastRun: now, nextRunAt: now + TAX_INTERVAL_MS } },
      { upsert: true },
    );

    log(
      "info",
      `[tax] ✅  Tax collected from ${result.modifiedCount}/${count} users ` +
      `(${count - highWealthCount} at 10%, ${highWealthCount} at 20%). ` +
      `Wallet: −${fmt(taxedMoney)} | Bank: −${fmt(taxedBank)}`
    );
    return {
      ok: true,
      count,
      modifiedCount: result.modifiedCount || 0,
      highWealthCount,
      topLeaderboardCount: topTwoIds.length,
      taxedMoney,
      taxedBank,
      collectedAt: now,
    };
    } finally {
      try {
        await releaseTaxLock(db, lockToken);
      } catch (error) {
        log("warn", `[tax] Could not release collection lock: ${error.message}`);
      }
    }
  } catch (err) {
    log("error", `[tax] Collection failed: ${err.message}`);
    return { ok: false, error: err };
  }
  })();

  _taxCollectionPromise = run;
  try {
    return await run;
  } finally {
    if (_taxCollectionPromise === run) _taxCollectionPromise = null;
  }
}

export async function collectTaxNow() {
  return collectTax();
}

// ── Scheduler entry point ────────────────────────────────────────────────────

/**
 * Check the persisted toggle and due time. Polling lets changes made through a
 * separate bot worker take effect without restarting the scheduler process.
 */
async function collectIfDue() {
  if (_scheduledCheckPromise) return _scheduledCheckPromise;

  const check = (async () => {
    const status = await getTaxAutomationStatus();
    if (!status.enabled || !status.nextRunAt || status.nextRunAt > Date.now()) return;
    const result = await collectTax({ automatic: true });
    if (result.busy) {
      log("info", "[tax] Another tax collection is already running; automatic run skipped.");
    }
  })();

  _scheduledCheckPromise = check;
  try {
    await check;
  } catch (error) {
    log("warn", `[tax] Scheduler check failed: ${error.message}`);
  } finally {
    if (_scheduledCheckPromise === check) _scheduledCheckPromise = null;
  }
}

/**
 * Call once from index.js after MongoDB is connected. Automatic tax is off
 * unless an owner/admin enables it with `.tax on`.
 */
export async function startTaxScheduler() {
  if (_taxTimer) return;

  const status = await getTaxAutomationStatus();
  log(
    "info",
    status.enabled
      ? `[tax] Automatic collection enabled; next run at ${new Date(status.nextRunAt).toISOString()}`
      : "[tax] Automatic collection is off; use .tax on to enable it.",
  );

  _taxTimer = setInterval(() => {
    void collectIfDue();
  }, POLL_INTERVAL_MS);
  _taxTimer.unref?.();
  await collectIfDue();
}
