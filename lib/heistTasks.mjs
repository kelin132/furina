export const MIN_HEIST_MEMBERS = 2;
export const MAX_HEIST_MEMBERS = 8;
export const HEIST_TASK_COUNT = 7;

const TASKS = [
  {
    stage: "RECON",
    prompt: (target) => `A patrol is watching the lobby near @${target}. How do you map a safe route?`,
    correct: "Watch the patrol pattern and mark the service corridor for the crew.",
    wrong: [
      "Rush the lobby before the crew is ready.",
      "Split up and guess which door is clear.",
    ],
    hardWrong: "Trigger a distraction before checking where the patrol moves.",
  },
  {
    stage: "BREACH",
    prompt: (target) => `The entry team is exposed and @${target} is pinned by the alarm lights.`,
    correct: "Use the crew's in-game gun as cover while the entry team moves together.",
    wrong: [
      "Charge ahead alone and leave the entry team behind.",
      "Fire wildly and reveal the crew's position.",
    ],
    hardWrong: "Keep firing after the crew has already moved to cover.",
  },
  {
    stage: "SECURITY",
    prompt: (target) => `The vault panel is counting down while @${target} holds the corridor.`,
    correct: "Have the hacker use the Hack Kit while the crew keeps watch.",
    wrong: [
      "Guess codes until the alarm timer runs out.",
      "Pull the panel apart without disabling the alarm.",
    ],
    hardWrong: "Restart the panel and erase the route the hacker already found.",
  },
  {
    stage: "VAULT",
    prompt: (target) => `The vault is open. @${target} spots marked cash bags and a sealed bonus case.`,
    correct: "Split the crew: secure the marked bags and keep the bonus case for the escape.",
    wrong: [
      "Grab loose cash without checking the marked bags.",
      "Let everyone crowd the same vault aisle.",
    ],
    hardWrong: "Keep loading bags after the alarm countdown turns red.",
    cashBonus: 2_000_000,
  },
  {
    stage: "COVER",
    prompt: (target) => `Police are closing in on @${target} and the bag team is still moving.`,
    correct: "Use a short in-game covering burst, then move the crew to the marked exit.",
    wrong: [
      "Keep shooting after the crew has reached cover.",
      "Leave the bag team exposed and run ahead.",
    ],
    hardWrong: "Chase the patrol away from the exit and separate from the crew.",
  },
  {
    stage: "RESCUE",
    prompt: (target) => `A security gate traps @${target} as the rest of the crew reaches the corridor.`,
    correct: "Use the Med Kit, hold the corridor, and pull them through together.",
    wrong: [
      "Rush the locked gate and trigger the alarm again.",
      "Split the crew between exits without checking the route.",
    ],
    hardWrong: "Send the only person with the key back into the vault alone.",
    abandon: (target) => `Cut @${target} loose and escape without them.`,
  },
  {
    stage: "GETAWAY",
    prompt: (target) => `The car is ready, but @${target} and the crew are counting on your call.`,
    correct: "Wait for the active crew, confirm the bags, and leave together.",
    wrong: [
      "Drive before the last crew member reaches the car.",
      "Take the blocked route while the patrol is watching.",
    ],
    hardWrong: "Stop the getaway to return for a bag left in the vault.",
    betrayal: "Take the whole bank haul and leave the crew behind.",
  },
];

const EXTRA_CREW_TASK = {
  stage: "ESCORT",
  prompt: (target) => `The bags are moving and @${target} needs help getting the crew across the service yard.`,
  correct: "Keep the bag team together and have the scout guide everyone to cover.",
  wrong: [
    "Send the bag team ahead without a lookout.",
    "Leave the bags unattended while the crew splits up.",
  ],
  hardWrong: "Change the route after the whole crew has already moved.",
};

function randomIndex(length, random) {
  return Math.min(length - 1, Math.floor(random() * length));
}

function shuffled(items, random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function createHeistTasks(memberIds, random = Math.random) {
  const members = [...new Set((memberIds || []).filter(Boolean))];
  if (members.length < MIN_HEIST_MEMBERS) {
    throw new RangeError(`A heist needs at least ${MIN_HEIST_MEMBERS} participants.`);
  }
  if (members.length > MAX_HEIST_MEMBERS) {
    throw new RangeError(`A heist supports at most ${MAX_HEIST_MEMBERS} participants.`);
  }

  const actors = shuffled(members, random);
  const taskCount = Math.max(HEIST_TASK_COUNT, actors.length);
  const stages = actors.length > HEIST_TASK_COUNT
    ? [...TASKS.slice(0, -1), EXTRA_CREW_TASK, TASKS[TASKS.length - 1]]
    : TASKS;

  return Array.from({ length: taskCount }, (_, index) => {
    const task = stages[index % stages.length];
    const actorIds = [actors[index % actors.length]];
    const targetChoices = members.filter((member) => member !== actorIds[0]);
    const targetId = targetChoices.length
      ? targetChoices[randomIndex(targetChoices.length, random)]
      : actorIds[0];
    const hard = random() < 0.4;
    const options = [
      { text: task.correct, outcome: "success" },
      ...task.wrong.map((text) => ({ text, outcome: "fail" })),
    ];
    if (hard) options.push({ text: task.hardWrong, outcome: "fail" });
    if (task.abandon) options.push({ text: task.abandon(targetId), outcome: "abandon" });
    if (task.betrayal) options.push({ text: task.betrayal, outcome: "betray" });
    const arrangedOptions = shuffled(options, random);
    const targetLabel = targetId === actorIds[0]
      ? `${targetId.split("@")[0].split(":")[0]} (you)`
      : targetId.split("@")[0].split(":")[0];
    const optionIndex = (outcome) =>
      arrangedOptions.findIndex((option) => option.outcome === outcome) + 1;

    return {
      stage: task.stage,
      actorIds,
      targetId,
      prompt: task.prompt(targetLabel),
      options: arrangedOptions.map(({ text }) => text),
      correctOption: optionIndex("success"),
      abandonOption: optionIndex("abandon") || null,
      betrayalOption: optionIndex("betray") || null,
      difficulty: hard ? "HARD" : "NORMAL",
      timeLimitMs: hard ? 15_000 : 28_000,
      cashBonus: task.cashBonus || 0,
    };
  });
}

export function getHeistAnswerOutcome(task, answer) {
  const number = Number(answer);
  if (!Number.isInteger(number) || number < 1 || number > task.options.length) return "invalid";
  if (number === task.correctOption) return "success";
  if (number === task.abandonOption) return "abandon";
  if (number === task.betrayalOption) return "betray";
  return "fail";
}

export function calculateHeistPayouts(members, bankLoot, betrayerId = null) {
  const activeMembers = members.filter((member) => !member.abandoned);
  if (!activeMembers.length) throw new RangeError("A completed heist needs an active crew member.");

  if (betrayerId) {
    const betrayer = activeMembers.find((member) => member.id === betrayerId);
    if (!betrayer) throw new RangeError("The betrayer must still be with the active crew.");
    const totalStakes = members.reduce((sum, member) => sum + member.stake, 0);
    return new Map([[betrayer.id, bankLoot + totalStakes]]);
  }

  const share = Math.floor(bankLoot / activeMembers.length);
  return new Map(activeMembers.map((member) => [member.id, share + member.stake]));
}

export function isCorrectHeistAnswer(task, answer) {
  return getHeistAnswerOutcome(task, answer) === "success";
}
