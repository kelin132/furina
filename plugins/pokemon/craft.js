import { craftPokemonItem, getTrainer } from "../../lib/pokemon/players.mjs";
import {
  formatPokemonCraftIngredients,
  getPokemonCraftRecipe,
  POKEMON_CRAFT_RECIPES,
} from "../../lib/pokemon/crafting.mjs";

export default {
  name: "craft",
  aliases: ["make"],
  description: "Craft Pokémon items with collected materials",
  category: "pokemon",
  usage: ".craft list | .craft <item>",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    if (!jid) return;

    const query = args.join(" ").trim();
    const trainer = await getTrainer(sender);
    if (!trainer) {
      return sock.sendMessage(jid, { text: "Start your Pokémon journey before crafting." }, { quoted: msg });
    }

    if (!query || query.toLowerCase() === "list") {
      const recipes = POKEMON_CRAFT_RECIPES.map((recipe) =>
        `• ${recipe.name}: ${formatPokemonCraftIngredients(recipe.ingredients)}`
      ).join("\n");
      return sock.sendMessage(jid, {
        text: `Pokémon crafting recipes\n${recipes}\n\nUse .craft <item> to make one.`,
      }, { quoted: msg });
    }

    const recipe = getPokemonCraftRecipe(query);
    if (!recipe) {
      return sock.sendMessage(jid, {
        text: "Unknown recipe. Use .craft list to see available items.",
      }, { quoted: msg });
    }

    const result = await craftPokemonItem(sender, recipe.id);
    if (!result.ok) {
      return sock.sendMessage(jid, {
        text: `Not enough materials for ${recipe.name}. Needed: ${formatPokemonCraftIngredients(recipe.ingredients)}.`,
      }, { quoted: msg });
    }

    return sock.sendMessage(jid, {
      text: `Crafted ${recipe.name} ×${recipe.quantity}.`,
    }, { quoted: msg });
  },
};
