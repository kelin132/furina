import { getTrainer, addXP } from "../../lib/pokemon/players.mjs";
import { claimDailyResearch, getDailyResearch } from "../../lib/pokemon/progression.mjs";
import { addMoney } from "../economy/database.js";

export default {
  name: "pquest",
  description: "View or claim your daily Pokémon research",
  category: "pokemon",
  usage: ".pquest | .pquest claim",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    if (!await getTrainer(sender)) {
      return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });
    }

    if (String(args[0] || "").toLowerCase() === "claim") {
      const result = await claimDailyResearch(sender);
      if (!result.ok) {
        const text = result.alreadyClaimed
          ? "Today's research reward has already been claimed."
          : `Research progress: ${result.state.progress}/${result.state.mission.goal}. Finish it before claiming.`;
        return sock.sendMessage(jid, { text }, { quoted: msg });
      }
      await addMoney(sender, result.state.mission.reward);
      await addXP(sender, result.state.mission.xp);
      return sock.sendMessage(jid, {
        text: `Research complete: ${result.state.mission.label}.\nReward: $${result.state.mission.reward.toLocaleString()} and ${result.state.mission.xp.toLocaleString()} trainer XP.`,
      }, { quoted: msg });
    }

    const state = await getDailyResearch(sender);
    return sock.sendMessage(jid, {
      text: `Daily research: ${state.mission.label}\nProgress: ${Math.min(state.progress, state.mission.goal)}/${state.mission.goal}\nReward: $${state.mission.reward.toLocaleString()} + ${state.mission.xp.toLocaleString()} trainer XP\n${state.claimed ? "Reward claimed." : state.remaining === 0 ? "Use .pquest claim to collect." : "Progress resets at 00:00 UTC."}`,
    }, { quoted: msg });
  },
};
