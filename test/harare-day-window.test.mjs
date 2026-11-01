import test from "node:test";
import assert from "node:assert/strict";
import { getHarareDayWindow } from "../lib/harareDayWindow.mjs";

test("Harare day window uses local midnight across UTC date boundaries", () => {
  const { start, end } = getHarareDayWindow(new Date("2026-11-01T22:30:00.000Z"));
  assert.equal(start.toISOString(), "2026-11-01T22:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-02T22:00:00.000Z");
});
