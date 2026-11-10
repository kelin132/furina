import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateHeistPayouts,
  createHeistTasks,
  getHeistAnswerOutcome,
  HEIST_TASK_COUNT,
  isCorrectHeistAnswer,
  MAX_HEIST_MEMBERS,
  MIN_HEIST_MEMBERS,
} from "../lib/heistTasks.mjs";

const crew = (count) => Array.from(
  { length: count },
  (_, index) => `player-${index + 1}@s.whatsapp.net`,
);

test("heists require a real crew and have a maximum crew size", () => {
  assert.equal(MIN_HEIST_MEMBERS, 2);
  assert.throws(() => createHeistTasks(crew(1)), /at least 2 participants/);
  assert.throws(() => createHeistTasks(crew(MAX_HEIST_MEMBERS + 1)), /at most 8 participants/);
});

test("every crew member gets an assigned turn across the seven stages", () => {
  const members = crew(7);
  const tasks = createHeistTasks(members, () => 0.37);

  assert.equal(tasks.length, HEIST_TASK_COUNT);
  assert.deepEqual(
    [...new Set(tasks.flatMap((task) => task.actorIds))].sort(),
    members.sort(),
  );
  assert.ok(tasks.every((task) => task.actorIds.length === 1));
});

test("larger crews get an extra stage so every member still acts", () => {
  const members = crew(8);
  const tasks = createHeistTasks(members, () => 0.73);

  assert.equal(tasks.length, 8);
  assert.deepEqual(
    [...new Set(tasks.flatMap((task) => task.actorIds))].sort(),
    members.sort(),
  );
  assert.equal(tasks.at(-1).stage, "GETAWAY");
});

test("each task has exactly one safe answer", () => {
  const tasks = createHeistTasks(crew(3), () => 0.61);

  for (const task of tasks) {
    assert.equal(task.options.filter((_, index) => isCorrectHeistAnswer(task, index + 1)).length, 1);
    assert.equal(getHeistAnswerOutcome(task, task.correctOption), "success");
    const wrongOption = task.options.findIndex((_, index) =>
      getHeistAnswerOutcome(task, index + 1) === "fail",
    ) + 1;
    assert.ok(wrongOption > 0);
    assert.equal(getHeistAnswerOutcome(task, wrongOption), "fail");
  }
});

test("rescue offers a deliberate abandon branch and getaway offers a risky betrayal", () => {
  const tasks = createHeistTasks(crew(2), () => 0.1);
  const rescue = tasks.find((task) => task.stage === "RESCUE");
  const getaway = tasks.find((task) => task.stage === "GETAWAY");

  assert.ok(rescue.abandonOption);
  assert.equal(getHeistAnswerOutcome(rescue, rescue.abandonOption), "abandon");
  assert.ok(getaway.betrayalOption);
  assert.equal(getHeistAnswerOutcome(getaway, getaway.betrayalOption), "betray");
});

test("hard stages add a wrong choice and shorten the decision timer", () => {
  const tasks = createHeistTasks(crew(2), () => 0.1);
  const hardTask = tasks[0];

  assert.equal(hardTask.difficulty, "HARD");
  assert.equal(hardTask.timeLimitMs, 15_000);
  assert.ok(hardTask.options.length >= 4);
});

test("invalid answers cannot resolve as a successful action", () => {
  const task = createHeistTasks(crew(2), () => 0.37)[0];
  assert.equal(getHeistAnswerOutcome(task, 0), "invalid");
  assert.equal(getHeistAnswerOutcome(task, task.options.length + 1), "invalid");
});

test("a rescued crew splits bank loot while an abandoned member loses their stake", () => {
  const members = [
    { id: "runner", stake: 1_000_000 },
    { id: "lookout", stake: 1_000_000, abandoned: true },
    { id: "hacker", stake: 1_000_000 },
  ];
  const payouts = calculateHeistPayouts(members, 30_000_000);

  assert.equal(payouts.get("runner"), 16_000_000);
  assert.equal(payouts.get("hacker"), 16_000_000);
  assert.equal(payouts.has("lookout"), false);
});

test("a successful double-cross awards the full haul and all entry stakes to one crew member", () => {
  const members = [
    { id: "runner", stake: 1_000_000 },
    { id: "lookout", stake: 1_000_000 },
    { id: "hacker", stake: 1_000_000, abandoned: true },
  ];
  const payouts = calculateHeistPayouts(members, 30_000_000, "runner");

  assert.deepEqual([...payouts.entries()], [["runner", 33_000_000]]);
});
