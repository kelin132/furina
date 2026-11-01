import { getTrainer } from "../../lib/pokemon/players.mjs";
import { getWeeklyStandings, joinWeeklyTournament, leaveWeeklyTournament } from "../../lib/pokemon/progression.mjs";
import { utcWeekKey } from "../../lib/pokemon/seasonal.mjs";

export default {
  name: "ptournament",
  description: "Join the weekly Pokémon battle tournament",
  category: "pokemon",
  usage: ".ptournament [join|leave|standings]",

  async run({ sock, msg, sender, args = [] }) {
    const jid = msg.discordChannelId || msg.key?.remoteJid;
    const action = String(args[0] || "standings").toLowerCase();
    if (action === "join") {
      const joined = await joinWeeklyTournament(sender);
      if (!joined) return sock.sendMessage(jid, { text: "Start your Pokémon journey first with .startjourney." }, { quoted: msg });
      return sock.sendMessage(jid, { text: `You're entered in this week's tournament. Wins in trainer battles count automatically. Use .ptournament standings to check the leaderboard. Week: ${utcWeekKey()}.` }, { quoted: msg });
    }
    if (action === "leave") {
      await leaveWeeklyTournament(sender);
      return sock.sendMessage(jid, { text: "You've left this week's tournament." }, { quoted: msg });
    }
    if (action !== "standings") {
      return sock.sendMessage(jid, { text: "Use .ptournament join, .ptournament standings, or .ptournament leave." }, { quoted: msg });
    }
    const trainer = await getTrainer(sender);
    const standings = await getWeeklyStandings(10);
    const rows = standings.map((entry, index) => `${index + 1}. ${entry.username || "Trainer"} — ${entry.tournamentWins || 0} wins`);
    return sock.sendMessage(jid, {
      text: `Weekly trainer tournament · ${utcWeekKey()} UTC\n${trainer?.tournamentWeek === utcWeekKey() ? "You are entered." : "Join with .ptournament join."}\n\n${rows.join("\n") || "No trainers have entered yet."}\n\nChallenge another entrant with ${msg.discordChannelId ? ".ch @user" : ".challenge @user"}. Completed trainer battles count toward the standings.`,
    }, { quoted: msg });
  },
};
