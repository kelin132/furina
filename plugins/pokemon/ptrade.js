import { getTrainer } from "../../lib/pokemon/players.mjs";
import { getTrainerParty } from "../../lib/pokemon/pokemonDb.mjs";
import { resolveChallengeTarget } from "../../lib/pokemon/challengeTarget.mjs";
import {
  acceptPokemonTradeOffer,
  createPokemonTradeOffer,
  declinePokemonTradeOffer,
} from "../../lib/pokemon/trades.mjs";

function orderedParty(trainer, party) {
  const ordered = (trainer.party || []).map(String)
    .map((id) => party.find((pokemon) => String(pokemon._id) === id))
    .filter(Boolean);
  for (const pokemon of party) {
    if (!ordered.some((entry) => String(entry._id) === String(pokemon._id))) ordered.push(pokemon);
  }
  return ordered;
}

function unwrapMessage(message) {
  let current = message || {};
  for (let index = 0; index < 5; index += 1) {
    const next =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message;
    if (!next) break;
    current = next;
  }
  return current;
}

function getContextInfo(msg) {
  const message = unwrapMessage(msg.message);
  return message.contextInfo ||
    message.extendedTextMessage?.contextInfo ||
    message.imageMessage?.contextInfo ||
    message.videoMessage?.contextInfo ||
    message.stickerMessage?.contextInfo ||
    null;
}

export default {
  name: "ptrade",
  description: "Offer a two-way Pokémon trade that the other trainer must accept",
  category: "pokemon",
  usage: ".ptrade @user <your party slot> <their party slot> | .ptrade accept <code>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const action = String(args[0] || "").toLowerCase();
    if (action === "accept" || action === "decline") {
      const code = String(args[1] || "");
      if (!/^[a-f0-9]{10}$/i.test(code)) {
        return sock.sendMessage(jid, { text: `Use .ptrade ${action} <10-character code>.` }, { quoted: msg });
      }
      if (action === "decline") {
        const declined = await declinePokemonTradeOffer(code, sender);
        return sock.sendMessage(jid, { text: declined ? "Trade declined." : "That trade is missing, expired, or not yours to decline." }, { quoted: msg });
      }
      let result;
      try {
        result = await acceptPokemonTradeOffer(code, sender);
      } catch (error) {
        console.error("[ptrade] Trade transaction failed:", error?.message || error);
        return sock.sendMessage(jid, { text: "Trade couldn't complete safely. No Pokémon should be moved; try again later." }, { quoted: msg });
      }
      const errorText = result.missing ? "Trade not found."
        : result.wrongUser ? "Only the invited trainer can accept this trade."
          : result.expired ? "That trade has expired."
            : result.inactive ? "That trade is no longer active."
              : result.ownershipChanged ? "One of the Pokémon has changed owners or is no longer in the party."
                : result.inRaid ? "A Pokémon in an active raid can't be traded."
                : result.starter ? "Starter Pokémon cannot be traded."
                  : result.keystone ? "Unequip the Key Stone before trading that Pokémon."
                    : result.trainerMissing ? "Both trainers must have active Pokémon journeys."
                      : null;
      if (errorText) return sock.sendMessage(jid, { text: errorText }, { quoted: msg });
      return sock.sendMessage(jid, {
        text: `Trade complete: ${result.offeredName} and ${result.requestedName} swapped owners.`,
      }, { quoted: msg });
    }

    const context = getContextInfo(msg);
    const quotedSender =
      context?.participant ||
      context?.quotedParticipant ||
      msg.quoted?.key?.participant ||
      (msg.quoted?.key?.remoteJid !== jid ? msg.quoted?.key?.remoteJid : null);
    const discordMention = String(args.find((value) => /^<@!?\d+>$/.test(value)) || "").match(/\d+/)?.[0];
    const rawTarget = context?.mentionedJid?.[0] ||
      quotedSender ||
      (msg.discordChannelId && discordMention ? `discord:${discordMention}` : null);
    const targetJid = await resolveChallengeTarget({ jid: rawTarget, sock, chatJid: jid });
    const slots = args.map((value) => Number(value)).filter((value) => Number.isInteger(value));
    if (!targetJid || slots.length < 2) {
      return sock.sendMessage(jid, {
        text: "Offer a two-way trade with .ptrade @user <your party slot> <their party slot>.\nThe other trainer must accept the code before either Pokémon moves. Offers expire after 10 minutes.",
      }, { quoted: msg });
    }
    if (targetJid === sender) {
      return sock.sendMessage(jid, { text: "You can't trade with yourself." }, { quoted: msg });
    }

    const [fromTrainer, toTrainer] = await Promise.all([getTrainer(sender), getTrainer(targetJid)]);
    if (!fromTrainer || !toTrainer) {
      return sock.sendMessage(jid, { text: "Both trainers must start their Pokémon journey first." }, { quoted: msg });
    }
    const [fromPartyDocs, toPartyDocs] = await Promise.all([
      getTrainerParty(sender),
      getTrainerParty(targetJid),
    ]);
    const fromParty = orderedParty(fromTrainer, fromPartyDocs);
    const toParty = orderedParty(toTrainer, toPartyDocs);
    const [offered, requested] = [fromParty[slots[0] - 1], toParty[slots[1] - 1]];
    if (!offered || !requested) {
      return sock.sendMessage(jid, {
        text: `Invalid party slot. Your party has ${fromParty.length} Pokémon; the other trainer has ${toParty.length}.`,
      }, { quoted: msg });
    }
    if (offered.isStarter || requested.isStarter) {
      return sock.sendMessage(jid, { text: "Starter Pokémon cannot be traded." }, { quoted: msg });
    }
    if (fromTrainer.keystoneEquippedTo === String(offered._id) || toTrainer.keystoneEquippedTo === String(requested._id)) {
      return sock.sendMessage(jid, { text: "Unequip the Key Stone before offering that Pokémon." }, { quoted: msg });
    }

    const offer = await createPokemonTradeOffer({
      fromJid: sender,
      toJid: targetJid,
      offeredPokemonId: offered._id,
      requestedPokemonId: requested._id,
    });
    const mentionLabel = msg.discordChannelId && String(rawTarget).startsWith("discord:")
      ? `<@${String(rawTarget).slice("discord:".length).split("@", 1)[0]}>`
      : `@${String(targetJid).split("@")[0]}`;
    return sock.sendMessage(jid, {
      text: `Trade offer ${offer._id}\n${fromTrainer.username || "Trainer"} offers ${offered.nickname || offered.displayName || offered.name} (party slot ${slots[0]}) for ${requested.nickname || requested.displayName || requested.name} (party slot ${slots[1]}).\nOnly the invited trainer ${mentionLabel} can accept or decline. Use .ptrade accept ${offer._id} or .ptrade decline ${offer._id}. Offer expires in 10 minutes.`,
      ...(!msg.discordChannelId ? { mentions: [targetJid] } : {}),
    }, { quoted: msg });
  },
};
