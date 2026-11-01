import { getTrainer } from "../../lib/pokemon/players.mjs";
import { claimPokemonPfeed, getTrainerParty } from "../../lib/pokemon/pokemonDb.mjs";
import { recordDailyProgress } from "../../lib/pokemon/progression.mjs";

const cooldownText = (ms) => {
  const minutes = Math.ceil(Math.max(0, ms) / 60000);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export default {
  name: "pfeed",
  description: "Feed and build a bond with your Pokémon",
  category: "pokemon",
  usage: ".pfeed <party slot>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const trainer = await getTrainer(sender);
    if (!trainer) return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });

    const party = await getTrainerParty(sender);
    const ordered = (trainer.party || []).map(String)
      .map((id) => party.find((pokemon) => String(pokemon._id) === id))
      .filter(Boolean);
    for (const pokemon of party) {
      if (!ordered.some((entry) => String(entry._id) === String(pokemon._id))) ordered.push(pokemon);
    }

    const slot = Number(args[0]);
    if (!Number.isInteger(slot) || slot < 1 || slot > ordered.length) {
      const list = ordered.map((pokemon, index) =>
        `${index + 1}. ${pokemon.displayName || pokemon.name} — Bond ${Number(pokemon.bond || 0)}/100`
      ).join("\n");
      return sock.sendMessage(jid, {
        text: `Use .pfeed <slot> to spend time with a Pokémon. Each Pokémon can be fed once every 12 hours.\n\n${list || "Your party is empty."}`,
      }, { quoted: msg });
    }

    const pokemon = ordered[slot - 1];
    const result = await claimPokemonPfeed(pokemon._id, sender);
    const name = pokemon.nickname || pokemon.displayName || pokemon.name;
    if (!result.ok) {
      if (result.notFound) return sock.sendMessage(jid, { text: "That Pokémon is no longer in your party." }, { quoted: msg });
      return sock.sendMessage(jid, { text: `${name} has already been fed. Try again in ${cooldownText(result.remainingMs)}.` }, { quoted: msg });
    }

    await recordDailyProgress(sender, "feed")
      .catch((error) => console.error("[pokemon research] Progress recording failed:", error?.message || error));
    return sock.sendMessage(jid, {
      text: `You spent time with ${name}. Bond increased to ${result.bond}/100.`,
    }, { quoted: msg });
  },
};
