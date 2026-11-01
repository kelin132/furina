import { getTrainer, updateTrainer } from "../../lib/pokemon/players.mjs";
import { getAllTrainerPokemon, getTrainerParty } from "../../lib/pokemon/pokemonDb.mjs";

export default {
  name: "pshowcase",
  description: "Choose or show your featured Pokémon",
  category: "pokemon",
  usage: ".pshowcase [party slot|clear]",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const trainer = await getTrainer(sender);
    if (!trainer) return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });

    const choice = String(args[0] || "").toLowerCase();
    if (choice === "clear" || choice === "off") {
      await updateTrainer(sender, { activeShowcasePokemonId: null });
      return sock.sendMessage(jid, { text: "Your featured Pokémon has been cleared." }, { quoted: msg });
    }
    if (choice) {
      const slot = Number(choice);
      const party = await getTrainerParty(sender);
      const ordered = (trainer.party || []).map(String)
        .map((id) => party.find((pokemon) => String(pokemon._id) === id))
        .filter(Boolean);
      for (const pokemon of party) {
        if (!ordered.some((entry) => String(entry._id) === String(pokemon._id))) ordered.push(pokemon);
      }
      if (!Number.isInteger(slot) || slot < 1 || slot > ordered.length) {
        return sock.sendMessage(jid, { text: `Choose a party slot from 1 to ${ordered.length}, or use .pshowcase clear.` }, { quoted: msg });
      }
      const pokemon = ordered[slot - 1];
      const id = String(pokemon._id);
      await updateTrainer(sender, { activeShowcasePokemonId: id });
      return sock.sendMessage(jid, { text: `${pokemon.nickname || pokemon.displayName || pokemon.name} is now your featured Pokémon.` }, { quoted: msg });
    }

    if (!trainer.activeShowcasePokemonId) {
      return sock.sendMessage(jid, { text: "Choose a party Pokémon with .pshowcase <slot>. Use .party to see your slots." }, { quoted: msg });
    }
    const allPokemon = await getAllTrainerPokemon(sender);
    const pokemon = allPokemon.find((entry) => String(entry._id) === String(trainer.activeShowcasePokemonId));
    if (!pokemon) {
      await updateTrainer(sender, { activeShowcasePokemonId: null });
      return sock.sendMessage(jid, { text: "Your featured Pokémon is no longer available. Choose another with .pshowcase <slot>." }, { quoted: msg });
    }
    const title = trainer.activePokemonTitle ? ` · ${trainer.activePokemonTitle}` : "";
    const caption = `${trainer.username || "Trainer"}${title}\n${pokemon.nickname || pokemon.displayName || pokemon.name} · Lv.${pokemon.level} · Bond ${Number(pokemon.bond || 0)}/100`;
    if (/^https?:\/\//i.test(pokemon.imageUrl || "")) {
      return sock.sendMessage(jid, { image: { url: pokemon.imageUrl }, caption }, { quoted: msg });
    }
    return sock.sendMessage(jid, { text: caption }, { quoted: msg });
  },
};
