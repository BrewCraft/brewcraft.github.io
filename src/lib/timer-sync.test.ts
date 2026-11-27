import test from "node:test";
import assert from "node:assert/strict";
import { remainingMs, pauseTimer, resumeTimer, mergeTimers, isExpired, completeTimer, type SyncedTimer } from "./timer-sync";

const base: SyncedTimer = { id: "t1", name: "Mostura", durationMs: 60000, startedAt: null, pausedAt: null, accumulatedMs: 0, status: "idle", completedAt: null, updatedAt: "2026-01-01T00:00:00.000Z" };

test("timer-sync: remainingMs após start", () => {
  const now = new Date("2026-01-01T00:00:10.000Z");
  const started = { ...base, status: "running" as const, startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(remainingMs(started, now), 50000);
});

test("timer-sync: pause preserva tempo restante", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const pauseAt = new Date("2026-01-01T00:00:10.000Z");
  const running = { ...base, status: "running" as const, startedAt: start.toISOString(), updatedAt: start.toISOString() };
  const paused = pauseTimer(running, pauseAt);
  assert.equal(paused.status, "paused");
  assert.equal(paused.accumulatedMs, 10000);
  assert.equal(remainingMs(paused, pauseAt), 50000);
});

test("timer-sync: resume continua contagem", () => {
  const paused = { ...base, status: "paused" as const, accumulatedMs: 10000, updatedAt: "2026-01-01T00:00:10.000Z" };
  const resumed = resumeTimer(paused, new Date("2026-01-01T00:00:10.000Z"));
  assert.equal(resumed.status, "running");
  const later = new Date("2026-01-01T00:00:20.000Z");
  assert.equal(remainingMs(resumed, later), 40000);
});

test("timer-sync: mergeTimers last-write-wins", () => {
  const a = { ...base, updatedAt: "2026-01-01T00:00:00.000Z", name: "A" };
  const b = { ...base, updatedAt: "2026-01-01T00:00:05.000Z", name: "B" };
  assert.equal(mergeTimers(a, b).name, "B");
  assert.equal(mergeTimers(b, a).name, "B");
});

test("timer-sync: isExpired true quando tempo esgotado", () => {
  const started = { ...base, status: "running" as const, startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(isExpired(started, new Date("2026-01-01T00:02:00.000Z")), true);
});

test("timer-sync: completeTimer zera remaining", () => {
  const c = completeTimer(base, new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(c.status, "completed");
  assert.equal(remainingMs(c), 0);
});