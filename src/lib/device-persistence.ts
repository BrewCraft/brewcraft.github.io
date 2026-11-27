/** Persistence helpers for alert configs, alert history and timers. */
import { read, write } from "./store";
import type { AlertConfig, AlertEvent, SyncedTimer } from "./fermentation-monitor";

const ALERT_CONFIGS_KEY = "brewfather-alert-configs";
const ALERT_HISTORY_KEY = "brewfather-alert-history";
const TIMERS_KEY = "brewfather-timers";

function lsRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function lsWrite(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
  window.dispatchEvent(new CustomEvent("brewfather-store", { detail: key }));
}

export function readAlertConfigs(): AlertConfig[] {
  return lsRead<AlertConfig[]>(ALERT_CONFIGS_KEY, []);
}

export function saveAlertConfigs(configs: AlertConfig[]) {
  lsWrite(ALERT_CONFIGS_KEY, configs);
}

export function readAlertHistory(): AlertEvent[] {
  return lsRead<AlertEvent[]>(ALERT_HISTORY_KEY, []);
}

export function saveAlertHistory(events: AlertEvent[]) {
  lsWrite(ALERT_HISTORY_KEY, events.slice(0, 200));
}

export function readTimers(): SyncedTimer[] {
  return lsRead<SyncedTimer[]>(TIMERS_KEY, []);
}

export function saveTimers(timers: SyncedTimer[]) {
  lsWrite(TIMERS_KEY, timers);
}

export function upsertTimer(timer: SyncedTimer) {
  const all = readTimers();
  const idx = all.findIndex(t => t.id === timer.id);
  if (idx >= 0) all[idx] = timer; else all.push(timer);
  saveTimers(all);
}