import { POKEMON_DESTINATIONS, resolvePokemonDestination } from "../../lib/pokemon/exploration.mjs";
import { getWeatherForDestination, utcDayKey } from "../../lib/pokemon/seasonal.mjs";

export default {
  name: "pweather",
  description: "Check today's Pokémon exploration weather",
  category: "pokemon",
  usage: ".pweather [place]",

  async run({ sock, msg, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const placeQuery = args.join(" ").trim();
    if (placeQuery) {
      const place = resolvePokemonDestination(placeQuery);
      if (!place) {
        return sock.sendMessage(jid, { text: `Unknown place. Choose: ${POKEMON_DESTINATIONS.map((item) => item.name).join(", ")}.` }, { quoted: msg });
      }
      const weather = getWeatherForDestination(place);
      const effects = [
        weather.boostType && `${weather.boostType} moves are slightly stronger`,
        weather.weakType && `${weather.weakType} moves are slightly weaker`,
      ].filter(Boolean).join("; ");
      return sock.sendMessage(jid, {
        text: `${place.name}: ${weather.name}${effects ? ` — ${effects}` : ""}. Forecast date: ${utcDayKey()} UTC.`,
      }, { quoted: msg });
    }

    const forecast = POKEMON_DESTINATIONS.map((place) => {
      const weather = getWeatherForDestination(place);
      return `${place.name}: ${weather.name}`;
    }).join("\n");
    return sock.sendMessage(jid, { text: `Today's exploration forecast (${utcDayKey()} UTC)\n\n${forecast}\n\nWeather bonuses apply during exploration battles.` }, { quoted: msg });
  },
};
