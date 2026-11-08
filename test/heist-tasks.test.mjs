import assert from "node:assert/strict";
import test from "node:test";
import { createHeistTasks, HEIST_TASK_COUNT, isCorrectHeistAnswer } from "../lib/heistTasks.mjs";

test("heists have five tasks and every participant is assigned at least once", () => {
  const members = ["one@s.whatsapp.net", "two@s.whatsapp.net", "three@s.whatsapp.net", "four@s.whatsapp.net", "five@s.whatsapp.net", "six@s.whatsapp.net", "seven@s.whatsapp.net"];
  const tasks = createHeistTasks(members, () => 0.37);

  assert.equal(tasks.length, HEIST_TASK_COUNT);
  assert.ok(tasks.every((task) => task.options.length === 3));
  assert.ok(tasks.every((task) => task.actorIds.length > 0));
  assert.deepEqual(
    tasks.flatMap((task) => task.actorIds).sort(),
    [...members].sort(),
  );
});

test("each task has exactly one correct answer", () => {
  const tasks = createHeistTasks(["one@s.whatsapp.net", "two@s.whatsapp.net"], () => 0.61);

  for (const task of tasks) {
    assert.equal(task.options.filter((_, index) => isCorrectHeistAnswer(task, index + 1)).length, 1);
    assert.equal(isCorrectHeistAnswer(task, task.correctOption), true);
    assert.equal(isCorrectHeistAnswer(task, task.correctOption === 1 ? 2 : 1), false);
  }
});

test("heists require at least two participants", () => {
  assert.throws(() => createHeistTasks(["one@s.whatsapp.net"]), RangeError);
});
