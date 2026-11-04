// plugins/owner/mods.js
// .mods  — list all guardians/mods with clean phone numbers
// .removemod — remove a user from the mods list

import { getModsData, getOwnerNumbers, saveModsData } from '../../lib/permissions.mjs';
import { getStaffMembers, removeStaffLevel } from '../economy/database.js';
import {
  bareNumber,
  getAllGroupNumberMap,
  getGroupNumberMap,
  getSocketLidNumberMap,
  mergeNumberMaps,
  storedRealNumber,
} from '../../lib/staffNumbers.mjs';

function cleanName(name, number) {
  const value = String(name || "").trim();
  return value && bareNumber(value) !== bareNumber(number) ? value : "";
}

function normalizeName(value) {
  return String(value || "").trim().replace(/^@/, "").replace(/\s+/g, " ").toLocaleLowerCase();
}

function commandSelector(msg) {
  const raw = String(
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    "",
  ).trim();
  return raw.replace(/^\S+\s*/, "").trim();
}

async function buildRoster(sock, jid, data) {
  const ownerNumbers = getOwnerNumbers();
  const botPhoneNumbers = new Set(
    [sock.user?.id, sock.user?.jid, sock.user?.phoneNumber]
      .map(bareNumber)
      .filter((number) => number.length >= 7),
  );
  const botIdentityNumbers = new Set(
    [...botPhoneNumbers, bareNumber(sock.user?.lid)].filter(Boolean),
  );
  const [dbStaff, currentGroupNumbers] = await Promise.all([
    getStaffMembers(),
    jid?.endsWith("@g.us") ? getGroupNumberMap(sock, jid) : Promise.resolve(new Map()),
  ]);
  const sourceNumbers = [
    ...ownerNumbers,
    ...dbStaff.map((user) => bareNumber(user._id || user.jid || user.userId)),
    ...data.map((entry) => bareNumber(entry.num)),
  ].filter(Boolean);
  const cleanNumMap = new Map(currentGroupNumbers);
  const unresolved = [...new Set(sourceNumbers)].filter((number) => !cleanNumMap.has(number));
  if (unresolved.length) {
    mergeNumberMaps(cleanNumMap, await getSocketLidNumberMap(sock, unresolved));
  }
  const stillUnresolved = unresolved.filter((number) => !cleanNumMap.has(number));
  if (stillUnresolved.length) {
    mergeNumberMaps(cleanNumMap, await getAllGroupNumberMap(sock));
  }
  const botLid = bareNumber(sock.user?.lid);
  if (botLid) {
    mergeNumberMaps(cleanNumMap, await getSocketLidNumberMap(sock, [botLid]));
    const resolvedBotPhone = bareNumber(cleanNumMap.get(botLid));
    if (resolvedBotPhone.length >= 7) botPhoneNumbers.add(resolvedBotPhone);
  }

  const byPhone = new Map();
  const ownerNumberSet = new Set(ownerNumbers);
  const isBotIdentity = (source, phone) => {
    const sourceNumber = bareNumber(source);
    const displayNumber = bareNumber(phone);
    const mappedNumber = bareNumber(cleanNumMap.get(sourceNumber));
    return botIdentityNumbers.has(sourceNumber) ||
      botPhoneNumbers.has(sourceNumber) ||
      botPhoneNumbers.has(displayNumber) ||
      botPhoneNumbers.has(mappedNumber);
  };
  const phoneFor = (source, user) => {
    const number = bareNumber(source);
    return storedRealNumber(user) || cleanNumMap.get(number) || number;
  };

  for (const source of ownerNumbers) {
    const phone = phoneFor(source);
    if (!phone || isBotIdentity(source, phone)) continue;
    byPhone.set(phone, {
      phone,
      name: "",
      level: 99,
      user: null,
      modEntries: [],
      sourceNumbers: new Set([source]),
      isOwner: true,
    });
  }

  for (const user of dbStaff) {
    const source = bareNumber(user._id || user.jid || user.userId);
    const phone = phoneFor(source, user);
    if (!phone || isBotIdentity(source, phone)) continue;
    const current = byPhone.get(phone) || {
      phone,
      name: "",
      level: 1,
      user: null,
      modEntries: [],
      sourceNumbers: new Set(),
      isOwner: false,
    };
    current.name = user.name || current.name;
    current.isOwner ||= ownerNumberSet.has(source) || ownerNumberSet.has(phone);
    current.level = current.isOwner ? 99 : Number(user.staffLevel) || 1;
    current.user = user;
    current.sourceNumbers.add(source);
    byPhone.set(phone, current);
  }

  for (const entry of data) {
    const source = bareNumber(entry.num);
    const phone = phoneFor(source);
    if (!phone || isBotIdentity(source, phone)) continue;
    const current = byPhone.get(phone) || {
      phone,
      name: "",
      level: 1,
      user: null,
      modEntries: [],
      sourceNumbers: new Set(),
      isOwner: false,
    };
    current.name = current.name || entry.name || "";
    current.isOwner ||= ownerNumberSet.has(source) || ownerNumberSet.has(phone);
    if (current.isOwner) current.level = 99;
    current.modEntries.push(entry);
    current.sourceNumbers.add(source);
    byPhone.set(phone, current);
  }

  const sorted = [...byPhone.values()].sort((a, b) =>
    b.level - a.level || String(a.name || "").localeCompare(String(b.name || "")),
  );
  return {
    numberMap: cleanNumMap,
    owners: sorted.filter((member) => member.isOwner || member.level >= 3),
    staff: sorted.filter((member) => !member.isOwner && member.level === 2),
    mods: sorted.filter((member) => !member.isOwner && member.level <= 1),
  };
}

export default {
  name:        'mods',
  description: 'List or remove bot moderators',
  category:    'owner',
  usage:       '.mods | .removemod <list number | name | phone | @user>',
  aliases:     ['removemod', 'modlist'],
  cooldown:    5,
  isOwner:     false,
  public:      true,

  async run({ sock, msg, cmd, isOwner }) {
    const jid  = msg.key.remoteJid;
    const data = getModsData();

    if (cmd === 'mods' || cmd === 'modlist') {
      const { owners, staff, mods } = await buildRoster(sock, jid, data);
      if (!owners.length && !staff.length && !mods.length) {
        return sock.sendMessage(jid, {
          text:
            `╭───〔 ⚔️ 𝐒𝐓𝐀𝐅𝐅 & 𝐌𝐎𝐃𝐒 〕───╮\n` +
            `│\n` +
            `│ No staff or mods found.\n` +
            `│\n` +
            `╰────────────────────╯`,
        }, { quoted: msg });
      }

      const formatRows = (members) => members.length
        ? members.map((member, index) => {
            const name = cleanName(member.name, member.phone);
            return `│ ${index + 1}. ${name ? `${name} ─ ` : ""}+${member.phone}`;
          })
        : ['│ None listed'];

      const caption = [
        '╭───〔 ⚔️ 𝐒𝐓𝐀𝐅𝐅 & 𝐌𝐎𝐃𝐒 〕───╮',
        '│',
        '│ ♢ 𝐎𝐖𝐍𝐄𝐑𝐒',
        ...formatRows(owners),
        '│',
        '│ ♢ 𝐒𝐓𝐀𝐅𝐅',
        ...formatRows(staff),
        '│',
        '│ ♢ 𝐌𝐎𝐃𝐒',
        ...formatRows(mods),
        '│',
        '╰────────────────────╯',
      ].join('\n');

      return sock.sendMessage(jid, {
        text: caption,
      }, { quoted: msg });
    }

    if (!isOwner) {
      return sock.sendMessage(jid, {
        text: "❌ Only the owner role can remove a moderator.",
      }, { quoted: msg });
    }

    const ctx        = msg.message?.extendedTextMessage?.contextInfo;
    const mentionJid = ctx?.mentionedJid?.[0];
    const quotedPart = ctx?.participant;
    const identity = mentionJid || quotedPart || "";
    const selector = commandSelector(msg);
    const roster = await buildRoster(sock, jid, data);
    const targetNumber = bareNumber(identity);
    let matches = [];

    if (targetNumber) {
      const resolved = roster.numberMap.get(targetNumber) || targetNumber;
      matches = roster.mods.filter((member) =>
        member.phone === resolved || member.sourceNumbers.has(targetNumber),
      );
    } else if (/^\d{1,3}$/.test(selector) && Number(selector) >= 1 && Number(selector) <= roster.mods.length) {
      matches = [roster.mods[Number(selector) - 1]];
    } else {
      const digits = bareNumber(selector);
      if (/^\d{7,16}$/.test(digits)) {
        const resolved = roster.numberMap.get(digits) || digits;
        matches = roster.mods.filter((member) =>
          member.phone === resolved || member.sourceNumbers.has(digits),
        );
      } else if (selector) {
        const wantedName = normalizeName(selector);
        matches = roster.mods.filter((member) => normalizeName(member.name) === wantedName);
      }
    }

    if (!identity && !selector) {
      return sock.sendMessage(jid, {
        text:
          `╭───〔 ⚔️ 𝐒𝐓𝐀𝐅𝐅 & 𝐌𝐎𝐃𝐒 〕───╮\n` +
          `│ ❌ Please specify a user to remove.\n` +
          `│\n` +
          `│ List number: .removemod 1\n` +
          `│ Name: .removemod Kelin\n` +
          `│ Mention: .removemod @user\n` +
          `│ Reply: .removemod\n` +
          `│ Phone: .removemod 27628114340\n` +
          `╰────────────────────╯`,
      }, { quoted: msg });
    }

    if (cmd === 'removemod') {
      if (!matches.length) {
        return sock.sendMessage(jid, {
          text:
            `╭───〔 ⚔️ 𝐒𝐓𝐀𝐅𝐅 & 𝐌𝐎𝐃𝐒 〕───╮\n` +
            `│ ❌ No matching moderator found. Check .mods and use its list number, exact name, or phone.\n` +
            `╰────────────────────╯`,
        }, { quoted: msg });
      }
      if (matches.length > 1) {
        return sock.sendMessage(jid, {
          text: "❌ More than one moderator matches. Use their phone number or list number from `.mods`.",
        }, { quoted: msg });
      }

      const target = matches[0];
      if (target.user) await removeStaffLevel(target.user._id);
      const entriesToRemove = new Set(target.modEntries);
      if (entriesToRemove.size) {
        for (let i = data.length - 1; i >= 0; i--) {
          if (entriesToRemove.has(data[i])) data.splice(i, 1);
        }
        saveModsData(data);
      }
      const name = cleanName(target.name, target.phone);
      const label = name ? `${name} (+${target.phone})` : `+${target.phone}`;

      return sock.sendMessage(jid, {
        text:
          `╭───〔 ⚔️ 𝐒𝐓𝐀𝐅𝐅 & 𝐌𝐎𝐃𝐒 〕───╮\n` +
          `│ ✅ Removed ${label} from mods.\n` +
          `╰────────────────────╯`,
      }, { quoted: msg });
    }
  },
};
