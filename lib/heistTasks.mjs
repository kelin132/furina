export const HEIST_TASK_COUNT = 5;

const TASKS = [
  {
    prompt: (target) => `Police have called out @${target}. Choose how to protect them.`,
    correct: "Use your in-game gun as a diversion and guide them to cover.",
    wrong: [
      "Leave them behind and split from the crew.",
      "Panic and expose the crew's escape route.",
    ],
  },
  {
    prompt: (target) => `The vault alarm is active and police are closing in on @${target}.`,
    correct: "Use the Hack Kit to disable the alarm, then signal the crew.",
    wrong: [
      "Guess codes until the alarm gets louder.",
      "Force the panel and leave the alarm running.",
    ],
  },
  {
    prompt: (target) => `@${target} is hurt while police approach. What is your move?`,
    correct: "Use the Med Kit and help them reach the safe exit.",
    wrong: [
      "Leave them behind to save time.",
      "Ignore the injury and split up.",
    ],
  },
  {
    prompt: (target) => `A patrol is approaching the exit where @${target} is waiting.`,
    correct: "Signal the crew to use the back exit and stay together.",
    wrong: [
      "Send everyone through the blocked exit.",
      "Make noise and draw the patrol toward the crew.",
    ],
  },
  {
    prompt: (target) => `The getaway car is ready, but @${target} is still inside.`,
    correct: "Wait for the whole crew and leave together.",
    wrong: [
      "Drive off without checking who made it out.",
      "Send the crew in different directions.",
    ],
  },
];

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
  if (members.length < 2) {
    throw new RangeError("A heist needs at least two participants.");
  }

  const actors = shuffled(members, random);
  const taskActors = Array.from({ length: HEIST_TASK_COUNT }, () => []);
  const turns = Math.max(HEIST_TASK_COUNT, actors.length);
  for (let turn = 0; turn < turns; turn++) {
    taskActors[turn % HEIST_TASK_COUNT].push(actors[turn % actors.length]);
  }

  return shuffled(TASKS, random).map((task, index) => {
    const actorIds = taskActors[index];
    const targetChoices = members.filter((member) => member !== actorIds[0]);
    const targetId = targetChoices[randomIndex(targetChoices.length, random)];
    const options = shuffled([
      { text: task.correct, correct: true },
      ...task.wrong.map((text) => ({ text, correct: false })),
    ], random);

    return {
      actorIds,
      targetId,
      prompt: task.prompt(targetId.split("@")[0].split(":")[0]),
      options: options.map(({ text }) => text),
      correctOption: options.findIndex(({ correct }) => correct) + 1,
    };
  });
}

export function isCorrectHeistAnswer(task, answer) {
  return Number.isInteger(Number(answer)) &&
    Number(answer) >= 1 &&
    Number(answer) <= task.options.length &&
    Number(answer) === task.correctOption;
}
