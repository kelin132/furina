/**
 * KELIN MD — Plugin manager
 * Hot-loadable ESM plugins from plugins/<category>/<name>.js
 *
 * Plugin export flags:
 *   isOwner      {boolean}  — owner-only
 *   isStaff      {boolean}  — staff (level ≥ 2) or owner
 *   isMod        {boolean}  — mod (level ≥ 1), staff, or owner
 *   isPremium    {boolean}  — premium, mod, staff, or owner
 *   checkJail    {boolean}  — legacy flag; jail status is enforced globally
 */
import { readdirSync, statSync, existsSync } from "fs";
import path from "path";
import { log } from "./logger.mjs";
import { getPermissions } from "./permissions.mjs";
import { groupSettings } from "./groupSettings.js";
import { ensureDb } from "./mongo.mjs";
import { syncWebsiteProfilePicture } from "./websiteAuth.mjs";
import { buildEconomyLinkPreview, getEconomyPreviewConfig } from "./economyPreview.mjs";
import { resolveMessageSender, normalizeJid } from "./identity.mjs";
import { getGroupMetadata, groupRoles } from "./groupIdentity.mjs";
import { invalidateShortRead } from "./shortReadCache.mjs";
import { getCommandAccessBlock } from "./commandAccess.mjs";

const PLUGINS_DIR = path.resolve("plugins");

let plugins  = [];   // { meta, run, category }
let commands = [];   // flat list of all command names + aliases
let commandIndex = new Map();

const profilePictureSyncInFlight = new Set();

// Per-sender command cooldowns. Plugins can still enforce longer,
// command-specific cooldowns inside their own handlers.
const commandCooldowns = new Map();
const WEBSITE_GATED_CATEGORIES = new Set(["economy", "cards", "pokemon"]);
const WEBSITE_REGISTRATION_URL = "https://aidoru.zone.id/login?mode=create";

// AFK users map — exported so plugins/utilities/afk.js can read/write it
export const afkUsers = new Map(); // sender JID -> { reason, time }

function afkKey(jid) {
  return String(jid || "").split("@")[0].split(":")[0];
}

export function getAfkUser(jid) {
  return afkUsers.get(jid) || afkUsers.get(afkKey(jid));
}

export function setAfkUser(jid, data) {
  invalidateShortRead(normalizeJid(jid));
  const value = { ...data, jid };
  afkUsers.set(jid, value);
  afkUsers.set(afkKey(jid), value);
}

export function deleteAfkUser(jid) {
  invalidateShortRead(normalizeJid(jid));
  const value = getAfkUser(jid);
  afkUsers.delete(jid);
  afkUsers.delete(afkKey(jid));
  if (value?.jid) afkUsers.delete(value.jid);
}

export async function loadPlugins(prefix = ".") {
  if (!existsSync(PLUGINS_DIR)) {
    log("warn", "No plugins/ directory found.");
    return { totalPlugins: plugins.length, totalCommands: commands.length };
  }

  const categories = readdirSync(PLUGINS_DIR).filter((f) =>
    statSync(path.join(PLUGINS_DIR, f)).isDirectory()
  );

  const pluginFiles = categories.flatMap((cat) => {
    const catDir = path.join(PLUGINS_DIR, cat);
    return readdirSync(catDir)
      .filter((file) => file.endsWith(".js"))
      .map((file) => ({ cat, file, filePath: path.join(catDir, file) }));
  });

  // Importing hundreds of plugins one-by-one made every worker wait on the
  // slowest module before WhatsApp could connect. Keep concurrency bounded so
  // panel hosts do not get a startup CPU/memory spike, while preserving the
  // deterministic category/file order in the final command table.
  const loaded = new Array(pluginFiles.length);
  let nextIndex = 0;
  const loadOne = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= pluginFiles.length) return;
      const { cat, file, filePath } = pluginFiles[index];
      try {
        const mod = await import(`${filePath}?v=${Date.now()}`);
        const plugin = mod.default;
        if (!plugin?.name || typeof plugin.run !== "function") continue;
        loaded[index] = { ...plugin, category: plugin.category || cat };
      } catch (err) {
        log("warn", `Failed to load plugin ${cat}/${file}: ${err.message}`);
      }
    }
  };
  const workerCount = Math.min(24, pluginFiles.length);
  await Promise.all(Array.from({ length: workerCount }, loadOne));

  const nextPlugins = [];
  const nextCommands = [];
  const nextCommandIndex = new Map();
  for (const plugin of loaded) {
    if (!plugin) continue;
    nextPlugins.push(plugin);
    nextCommands.push(plugin.name, ...(plugin.aliases ?? []));
    for (const commandName of [plugin.name, ...(plugin.aliases ?? [])]) {
      const normalized = String(commandName || "").toLowerCase();
      if (normalized && !nextCommandIndex.has(normalized)) {
        nextCommandIndex.set(normalized, plugin);
      }
    }
  }

  // Build the replacement table off to the side. During an update, messages
  // can still arrive while imports are in flight; clearing the live table
  // first makes every command look unknown for the duration of the reload.
  // Keep the previous working table if the replacement loaded nothing.
  if (nextPlugins.length === 0 && plugins.length > 0) {
    log("warn", "Plugin reload produced no valid plugins; keeping the previous plugin table.");
    return { totalPlugins: plugins.length, totalCommands: commands.length };
  }

  plugins = nextPlugins;
  commands = nextCommands;
  commandIndex = nextCommandIndex;

  log("info", `Loaded ${plugins.length} plugins from ${categories.length} categories`);
  return { totalPlugins: plugins.length, totalCommands: commands.length };
}

export async function routeMessage(sock, msg, prefix = ".", ownerNumber = "", fromMe = false) {
  const body =
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    "";

  if (!body.startsWith(prefix)) return;

  const chatId = msg.key.remoteJid;
  const isDM   = !chatId?.endsWith("@g.us");

  // Preserve the original message body so commands such as broadcast can
  // send paragraphs and intentional spacing instead of one continuous line.
  const commandBody = body.slice(prefix.length).trim();
  if (!commandBody && isDM) return;
  const commandMatch = commandBody.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  const rawCmd = commandMatch?.[1] || "";
  const rawText = commandMatch?.[2] || "";
  const cmd = rawCmd.toLowerCase();
  const text = rawText.trim();
  const args = text ? text.split(/\s+/) : [];

  // Full JID from participant (groups) or remoteJid (DM)
  const rawSender = msg.key.participant || msg.key.remoteJid || "";
  const alternateSender = isDM ? msg.key.remoteJidAlt || "" : msg.key.participantAlt || "";
  let sender = rawSender;
  // WhatsApp now routes some group senders through privacy LIDs. Resolve the
  // verified phone JID before permissions and commands query existing accounts.
  if (rawSender) {
    try {
      sender = await resolveMessageSender(rawSender, alternateSender, sock, chatId);
    } catch {
      // If the native mapping/DB is unavailable, preserve the LID and allow
      // the existing command error handling to report any database failure.
      sender = rawSender;
    }
  }

  const plugin = commandIndex.get(cmd);
  const commandStartedAt = Date.now();
  const fastPublicCommand =
    plugin?.name === "ping" &&
    !plugin.isOwner &&
    !plugin.isStaff &&
    !plugin.isMod &&
    !plugin.isAdmin &&
    !plugin.isPremium;

  // The normal index.js boot path awaits connectDb(). Under a temporary outage,
  // never make every command wait for the MongoDB server-selection timeout.
  // Database-backed commands will fail fast with the existing command error while
  // this best-effort retry continues in the background.
  if (!fastPublicCommand) void ensureDb().catch(() => {});

  // Every command, including `.ping` and unknown commands, must check
  // moderation status before it can reach a handler.
  const perms = await getPermissions(sender, ownerNumber, { fromMe, sock, chatId });
  const { isOwner, isStaff, isMod, isPremium, isJailed, isBanned, staffLevel, staffImmunity } = perms;
  const accessBlock = getCommandAccessBlock({
    isOwner,
    isBanned,
    isJailed,
    moderationStatusAvailable: perms.moderationStatusAvailable,
  });

  if (accessBlock === "unavailable") {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "⚠️ I couldn't verify your bot access right now. Please try again shortly." },
      { quoted: msg },
    );
    return;
  }
  if (accessBlock === "banned") {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "🚫 You are *banned* from using this bot.\nContact the owner to appeal." },
      { quoted: msg },
    );
    return;
  }
  if (accessBlock === "jailed") {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "🔒 You are in *jail* and cannot use bot commands until a staff member releases you." },
      { quoted: msg },
    );
    return;
  }

  if (!plugin) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "*NO SUCH COMMAND, BAKA*" },
      { quoted: msg },
    );
    return;
  }

  // Profile syncing is unrelated to command authorization. In particular, do
  // not make the owner wait for their own avatar lookup on every command.
  if (!isOwner && sender && !sender.endsWith("@g.us")) {
    if (!profilePictureSyncInFlight.has(sender)) {
      profilePictureSyncInFlight.add(sender);
      void (async () => {
        try {
          const profilePictureUrl = await sock.profilePictureUrl(sender, "image").catch(() => null);
          if (profilePictureUrl) await syncWebsiteProfilePicture(sender, profilePictureUrl);
        } catch {
          // Profile-picture access is optional; command routing must continue.
        } finally {
          profilePictureSyncInFlight.delete(sender);
        }
      })();
    }
  }

  // Keep DMs owner-only for administrative commands, but allow public utility
  // commands that are useful in a private chat too. In particular, `.ig URL`
  // must reach the downloader instead of being silently blocked here.
  const publicDmCommands = new Set([
    "register", "reg", "signup", "instagram", "ig", "igdl", "reels", "insta", "reel",
    "discordlink", "linkdiscord",
  ]);
  if (isDM && !isOwner && !publicDmCommands.has(cmd)) return;

  // ── Bare prefix or unknown command ──────────────────────────────────────
  if (!cmd) {
    await sock.sendMessage(
      msg.key.remoteJid,
      {
        text:
          "*NO SUCH COMMAND, BAKA*",
      },
      { quoted: msg }
    );
    return;
  }

  // ── Bot disabled in this group ───────────────────────────────────────────
  // Owners and mods can still use the .bot command to re-enable.
  if (chatId?.endsWith("@g.us")) {
    const gs = groupSettings.get(chatId);
    if (gs.botEnabled === false) {
      const isBotCmd = cmd === "bot" || cmd === "boton" || cmd === "botoff";
      if (!isBotCmd || (!isMod && !isOwner)) return; // silently ignore
    }
  }

  // ── Category disabled in this group ─────────────────────────────────────
  // Staff, mods, and owners bypass category restrictions.
  const isRegisterCommand = plugin.name === "register";
  if (chatId?.endsWith("@g.us") && !isRegisterCommand && !isMod && !isStaff && !isOwner) {
    const gs = groupSettings.get(chatId);
    const disabledCats = gs.disabledCategories || [];
    const pluginCat = plugin.category || "";
    if (disabledCats.includes(pluginCat)) {
      await sock.sendMessage(
        chatId,
        { text: `🔒 The *${pluginCat}* category is currently *disabled* in this group.\nAsk a staff member to enable it with \`.enablecat ${pluginCat}\`` },
        { quoted: msg }
      );
      return;
    }
  }

  // Staff-category commands are never available to regular users, even if a
  // plugin was added without its own isStaff/isMod metadata.
  if (plugin.category === "staff" && !isMod && !isStaff && !isOwner) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "*NO SUCH COMMAND, BAKA*" },
      { quoted: msg }
    );
    return;
  }

  // ── Hidden commands: invisible to non-authorized users ───────────────────
  if (plugin.hidden && !isMod && !isStaff && !isOwner) {
    await sock.sendMessage(
      msg.key.remoteJid,
      { text: "*NO SUCH COMMAND, BAKA*" },
      { quoted: msg }
    );
    return;
  }

  // ── Permission gate ──────────────────────────────────────────────────────
  if (plugin.isOwner && !isOwner && !isMod) {
    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Owner only command." }, { quoted: msg });
    return;
  }
  if (plugin.isStaff && !isStaff && !isOwner) {
    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Staff only command." }, { quoted: msg });
    return;
  }
  if (plugin.isMod && !isMod && !isOwner) {
    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Mod only command." }, { quoted: msg });
    return;
  }
  if (plugin.isPremium && !isPremium && !isOwner) {
    await sock.sendMessage(msg.key.remoteJid, { text: "❌ Premium only command." }, { quoted: msg });
    return;
  }

  // ── Group admin gate (isAdmin: true on a plugin) ──────────────────────────
  if (plugin.isAdmin && !isOwner) {
    if (!chatId?.endsWith("@g.us")) {
      await sock.sendMessage(msg.key.remoteJid, { text: "❌ This command can only be used in groups." }, { quoted: msg });
      return;
    }
    try {
      const meta = await getGroupMetadata(sock, chatId);
      const { senderIsAdmin: isGroupAdmin } = await groupRoles(sock, meta, rawSender, alternateSender);
      if (!isGroupAdmin) {
        await sock.sendMessage(msg.key.remoteJid, { text: "❌ Group admins only." }, { quoted: msg });
        return;
      }
    } catch {
      await sock.sendMessage(chatId, { text: "❌ Could not verify group admin permissions. Please retry." }, { quoted: msg });
      return;
    }
  }

  // Website verification is the only public registration path. Reuse the
  // registration bit already included in the permission snapshot so this
  // gate adds no extra Mongo round-trip on normal commands. A null value means
  // the permission read itself failed; let the command's existing DB handling
  // report that outage instead of mislabeling the user as unregistered.
  if (
    !isRegisterCommand &&
    !isOwner &&
    !isMod &&
    !isStaff &&
    WEBSITE_GATED_CATEGORIES.has(plugin.category || "") &&
    perms.registered === false
  ) {
    const inGroup = chatId?.endsWith("@g.us");
    const mention = inGroup ? `@${sender.split("@")[0].split(":")[0]} ` : "";
    const mentions = inGroup && sender ? [sender] : [];
    await sock.sendMessage(
      chatId,
      {
        text:
          `🌐 *${mention}Register your AIDORU account on the website first.*\n\n` +
          `Open ${WEBSITE_REGISTRATION_URL} and verify the same WhatsApp number you use with this bot. ` +
          `Your website login will connect to your bot account. Then send *.register* here to confirm.`,
        ...(mentions.length ? { mentions } : {}),
      },
      { quoted: msg, ...(mentions.length ? { mentions } : {}) },
    );
    return;
  }

  // Enforce the cooldown declared by each plugin. Economy commands use a
  // six-second default, while commands with longer metadata keep their own
  // configured value.
  const cooldownSeconds = Number(plugin.cooldown);
  if (Number.isFinite(cooldownSeconds) && cooldownSeconds > 0) {
    const cooldownMs = cooldownSeconds * 1000;
    const cooldownKey = `${sender}:${plugin.name}`;
    const lastUsed = commandCooldowns.get(cooldownKey) || 0;
    const remainingMs = cooldownMs - (Date.now() - lastUsed);

    if (remainingMs > 0) {
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      await sock.sendMessage(msg.key.remoteJid, {
        text: `⏳ Please wait *${remainingSeconds}s* before using *.${plugin.name}* again.`,
      }, { quoted: msg });
      return;
    }

    commandCooldowns.set(cooldownKey, Date.now());
  }

  // Normalize aliases so `.bal` and `.cf` get the same preview as their
  // canonical commands. The selected money and game commands share the URL
  // and rich preview in their first successful message.
  const previewAliases = new Map([["bal", "balance"], ["cf", "coinflip"]]);
  const previewCommands = new Set(["dep", "wd", "daily", "balance", "gamble", "bet", "coinflip", "slots"]);
  const previewCommand = [plugin.name, cmd, ...(plugin.aliases || [])]
    .map((name) => String(name || "").toLowerCase())
    .map((name) => previewAliases.get(name) || name)
    .find((name) => previewCommands.has(name));
  const shouldAttachPreview = Boolean(previewCommand);
  let previewSent = false;
  const commandSock = shouldAttachPreview
    ? new Proxy(sock, {
        get(target, property) {
          if (property !== "sendMessage") return Reflect.get(target, property, target);
          return async (chatId, content = {}, options) => {
            const previewTextKey = typeof content?.text === "string"
              ? "text"
              : typeof content?.caption === "string" ? "caption" : null;
            const firstText = previewTextKey ? content[previewTextKey] : "";
            const isInstructionOrFailure = /\b(?:usage|cooldown|minimum (?:bet|wager)|maximum (?:bet|wager)|invalid|not enough|insufficient|register(?:ed)?|error|failed|please try again)\b|❌|⚠️|⛔/i.test(firstText);
            if (!previewSent && content && typeof content === "object" && previewTextKey && !isInstructionOrFailure) {
              const config = getEconomyPreviewConfig(previewCommand);
              const linkPreview = await buildEconomyLinkPreview(previewCommand);
              if (config) {
                const originalText = content[previewTextKey];
                const messageText = originalText.includes(config.url)
                  ? originalText
                  : `${originalText.trimEnd()}\n${config.url}`;
                const previewContent = {
                  ...content,
                  [previewTextKey]: messageText,
                  ...(linkPreview ? { linkPreview } : {}),
                };
                try {
                  const sent = await target.sendMessage.call(target, chatId, previewContent, options);
                  previewSent = true;
                  return sent;
                } catch (richPreviewError) {
                  console.warn(`[${plugin.name}] Arcade link preview failed; sending the same message with its visible URL:`, richPreviewError?.message || richPreviewError);
                  try {
                    const fallbackContent = { ...content, [previewTextKey]: messageText };
                    const sent = await target.sendMessage.call(target, chatId, fallbackContent, options);
                    previewSent = true;
                    return sent;
                  } catch (fallbackError) {
                    console.warn(`[${plugin.name}] combined Arcade message fallback failed:`, fallbackError?.message || fallbackError);
                    throw fallbackError;
                  }
                }
              }
            }
            return target.sendMessage.call(target, chatId, content, options);
          };
        },
      })
    : sock;

  try {
    await plugin.run({
      sock: commandSock, msg, args, text, cmd, sender, prefix,
      pushName: msg.pushName || "",
      isOwner, isStaff, isMod, isPremium, isJailed, staffLevel, staffImmunity,
    });
  } catch (err) {
    log("error", `Plugin ${plugin.name} error: ${err.message}`);
    await sock.sendMessage(msg.key.remoteJid, {
      text: `❌ Command failed: ${err.message}`,
    }, { quoted: msg });
  } finally {
    const elapsed = Date.now() - commandStartedAt;
    if (elapsed >= 1000) {
      log("warn", `[perf] .${plugin.name} completed in ${elapsed}ms`);
    }
  }
}

export function getPlugins()  { return plugins; }
export function getCommands() { return commands; }
