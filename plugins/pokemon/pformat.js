import { getWeeklyBattleRule, utcWeekKey } from "../../lib/pokemon/seasonal.mjs";

export default {
  name: "pformat",
  description: "View the current rotating Pokémon battle rule",
  category: "pokemon",
  usage: ".pformat",

  async run({ sock, msg }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const rule = getWeeklyBattleRule();
    return sock.sendMessage(jid, {
      text: `Weekly battle format: ${rule.name}\n${rule.boostType} moves deal 15% more damage; ${rule.weakType} moves deal 10% less damage.\nRules rotate every Monday (UTC). Current week: ${utcWeekKey()}.`,
    }, { quoted: msg });
  },
};
