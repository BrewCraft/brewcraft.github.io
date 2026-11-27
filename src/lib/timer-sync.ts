/** Timestamp-based timer state for cross-device sync. */
export interface SyncedTimer {
  id: string;
  name: string;
  durationMs: number;
  startedAt: string | null; // ISO when running
  pausedAt: string | null;
  accumulatedMs: number; // ms already elapsed before current run
  status: "idle" | "running" | "paused" | "completed" | "cancelled";
  completedAt: string | null;
  updatedAt: string;
}

export function remainingMs(timer: SyncedTimer, now = new Date()): number {
  if (timer.status === "completed" || timer.status === "cancelled") return 0;
  let elapsed = timer.accumulatedMs;
  if (timer.status === "running" && timer.startedAt) {
    elapsed += now.getTime() - new Date(timer.startedAt).getTime();
  }
  return Math.max(0, timer.durationMs - elapsed);
}

export function isExpired(timer: SyncedTimer, now = new Date()): boolean {
  return timer.status === "running" && remainingMs(timer, now) <= 0;
}

export function startTimer(timer: SyncedTimer, now = new Date()): SyncedTimer {
  if (timer.status === "running") return timer;
  return {
    ...timer,
    status: "running",
    startedAt: now.toISOString(),
    pausedAt: null,
    updatedAt: now.toISOString(),
  };
}

export function pauseTimer(timer: SyncedTimer, now = new Date()): SyncedTimer {
  if (timer.status !== "running" || !timer.startedAt) return timer;
  const elapsed = now.getTime() - new Date(timer.startedAt).getTime();
  return {
    ...timer,
    status: "paused",
    pausedAt: now.toISOString(),
    startedAt: null,
    accumulatedMs: timer.accumulatedMs + elapsed,
    updatedAt: now.toISOString(),
  };
}

export function resumeTimer(timer: SyncedTimer, now = new Date()): SyncedTimer {
  if (timer.status !== "paused") return timer;
  return {
    ...timer,
    status: "running",
    startedAt: now.toISOString(),
    pausedAt: null,
    updatedAt: now.toISOString(),
  };
}

export function cancelTimer(timer: SyncedTimer, now = new Date()): SyncedTimer {
  return { ...timer, status: "cancelled", startedAt: null, pausedAt: null, updatedAt: now.toISOString() };
}

export function completeTimer(timer: SyncedTimer, now = new Date()): SyncedTimer {
  return { ...timer, status: "completed", startedAt: null, pausedAt: null, completedAt: now.toISOString(), accumulatedMs: timer.durationMs, updatedAt: now.toISOString() };
}

export function mergeTimers(local: SyncedTimer, remote: SyncedTimer): SyncedTimer {
  // last-write-wins by updatedAt
  return new Date(remote.updatedAt).getTime() >= new Date(local.updatedAt).getTime() ? { ...remote } : { ...local };
}