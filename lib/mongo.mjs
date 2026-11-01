/**
 * KELIN MD — MongoDB connection singleton
 * All plugins that need the database import getDb() from here.
 *
 * Usage:
 *   - Call `await connectDb()` once at startup (index.js).
 *   - Call `getDb()` (synchronous) anywhere after that — returns the live db.
 */
import { MongoClient } from "mongodb";
import { log } from "./logger.mjs";
import { ensurePerformanceIndexes } from "./performanceIndexes.mjs";

let client = null;
let db = null;
let connecting = null;
let lastConnectFailure = null;
let lastConnectFailureAt = 0;
const CONNECT_FAILURE_COOLDOWN_MS = 10_000;
const SLOW_MONGO_QUERY_MS = Math.max(
  100,
  Number(process.env.MONGO_SLOW_QUERY_MS || 250),
);
// Log database operations that exceed the slow-query threshold by default so
// command latency can be attributed to MongoDB from the hosting panel logs.
const MONITOR_MONGO_COMMANDS = process.env.MONGO_MONITOR_COMMANDS !== "false";

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function attachMongoDiagnostics(nextClient) {
  const commandTargets = new Map();
  nextClient.on("commandStarted", (event) => {
    const resource = event.command?.[event.commandName];
    commandTargets.set(event.requestId, {
      database: String(event.databaseName || ""),
      collection: typeof resource === "string" ? resource : "",
      comment: typeof event.command?.comment === "string" ? event.command.comment : "",
    });
    if (commandTargets.size > 10000) commandTargets.delete(commandTargets.keys().next().value);
  });

  nextClient.on("commandSucceeded", (event) => {
    const duration = Number(event.duration || 0);
    const target = commandTargets.get(event.requestId);
    commandTargets.delete(event.requestId);
    if (duration >= SLOW_MONGO_QUERY_MS &&
      !["hello", "createIndexes", "listIndexes"].includes(event.commandName)) {
      const isGroupSettingsStartupRead = target?.comment === "groupSettings-startup-cache";
      const namespace = target?.database && target?.collection
        ? ` ${target.database}.${target.collection}`
        : "";
      if (isGroupSettingsStartupRead && duration < Math.max(SLOW_MONGO_QUERY_MS, 1000)) {
        log("info", `[mongo] groupSettings startup cache read ${duration}ms`);
      } else {
        log("warn", `[mongo] slow ${event.commandName}${namespace} ${duration}ms`);
      }
    }
  });

  nextClient.on("commandFailed", (event) => {
    const target = commandTargets.get(event.requestId);
    commandTargets.delete(event.requestId);
    const namespace = target?.database && target?.collection
      ? ` ${target.database}.${target.collection}`
      : "";
    log(
      "warn",
      `[mongo] failed ${event.commandName}${namespace} after ${Number(event.duration || 0)}ms`,
    );
  });
}

/**
 * Synchronous getter — returns the cached db instance.
 * Throws if connectDb() has not been called yet.
 * Used by Col helpers in plugins/cards/database.js and lib/cardSpawner.mjs.
 */
export function getDb() {
  if (!db) {
    throw new Error(
      "Database not connected yet. Make sure connectDb() is awaited before loading plugins."
    );
  }
  return db;
}

/**
 * Async initializer — call once at startup before loading plugins.
 * Safe to call multiple times (no-op after first successful connect).
 */
export async function connectDb({ skipPerformanceIndexes = process.env.SKIP_PERFORMANCE_INDEXES === "true" } = {}) {
  if (db) return db;
  if (connecting) return connecting;
  if (lastConnectFailure && Date.now() - lastConnectFailureAt < CONNECT_FAILURE_COOLDOWN_MS) {
    throw lastConnectFailure;
  }

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not set! Add it to your .env file.");
  }

  connecting = (async () => {
    const nextClient = new MongoClient(mongoUri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 10000,
      maxPoolSize: positiveInt(process.env.MONGO_MAX_POOL_SIZE, 50),
      minPoolSize: positiveInt(process.env.MONGO_MIN_POOL_SIZE, 5),
      maxConnecting: positiveInt(process.env.MONGO_MAX_CONNECTING, 4),
      waitQueueTimeoutMS: positiveInt(process.env.MONGO_WAIT_QUEUE_TIMEOUT_MS, 10000),
      retryWrites: true,
      monitorCommands: MONITOR_MONGO_COMMANDS,
    });
    if (MONITOR_MONGO_COMMANDS) attachMongoDiagnostics(nextClient);
    await nextClient.connect();
    client = nextClient;
    db = client.db("kelin_md");
    lastConnectFailure = null;
    lastConnectFailureAt = 0;
    log("info", "✅ Connected to MongoDB (kelin_md)");
    // Index maintenance must not hold WhatsApp connection/command startup.
    // Failures are reported, not silently mistaken for successful setup.
    if (!skipPerformanceIndexes) {
      void ensurePerformanceIndexes(db).catch((error) => {
        log("warn", `[indexes] Background maintenance failed: ${error.message}`);
      });
    }
    return db;
  })();

  try {
    return await connecting;
  } catch (error) {
    lastConnectFailure = error;
    lastConnectFailureAt = Date.now();
    throw error;
  } finally {
    connecting = null;
  }
}

/** Ensure command handlers have a live database, even under alternate launchers. */
export async function ensureDb() {
  return db || connectDb();
}

/** Called on graceful shutdown */
export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connecting = null;
  }
}
