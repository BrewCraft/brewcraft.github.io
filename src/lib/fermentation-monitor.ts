/** Pure fermentation monitoring, device reading validation and alert helpers. */
import { calculateAbv, defaultSettings, type AppSettings } from "./settings-model";

export type DeviceKind = "tilt" | "ispindel" | "rapt" | "manual";
export type ReadingSource = "automatic" | "manual";

export interface DeviceReading {
  id: string;
  deviceId: string;
  deviceKind: DeviceKind;
  batchId?: string;
  timestamp: string; // ISO
  gravity?: number; // SG
  temperatureC?: number;
  angle?: number; // iSpindel
  batteryV?: number; // iSpindel/RAPT
  rssi?: number;
  source: ReadingSource;
  valid: boolean;
  invalidReason?: string;
}

export interface FermentationDevice {
  id: string;
  kind: DeviceKind;
  label: string;
  identifier: string; // color for Tilt, device id for others
  batchId?: string;
  lastSeen?: string;
  enabled: boolean;
}

export interface AlertConfig {
  batchId: string;
  tempMin?: number;
  tempMax?: number;
  gravityMin?: number;
  gravityMax?: number;
  maxGravityDropPerHour?: number; // SG/h
  noReadingMinutes?: number;
  stabilizationHours?: number;
  minIntervalMinutes: number;
  enabled: boolean;
}

export interface AlertEvent {
  id: string;
  batchId: string;
  configId: string;
  triggeredAt: string;
  condition: string;
  message: string;
  readingId?: string;
  dismissed: boolean;
}

export function isValidGravity(sg: number | undefined): boolean {
  if (sg === undefined || !Number.isFinite(sg)) return false;
  return sg >= 0.990 && sg <= 1.200;
}

export function isValidTemperature(c: number | undefined): boolean {
  if (c === undefined || !Number.isFinite(c)) return false;
  return c >= -5 && c <= 50;
}

export function validateReading(r: { gravity?: number; temperatureC?: number }): { valid: boolean; reason?: string } {
  if (r.gravity !== undefined && !isValidGravity(r.gravity)) return { valid: false, reason: "Gravidade fora da faixa válida (0.990–1.200 SG)" };
  if (r.temperatureC !== undefined && !isValidTemperature(r.temperatureC)) return { valid: false, reason: "Temperatura fora da faixa válida (-5 a 50 °C)" };
  if (r.gravity === undefined && r.temperatureC === undefined) return { valid: false, reason: "Leitura sem gravidade e sem temperatura" };
  return { valid: true };
}

export function dedupeReadings(existing: DeviceReading[], incoming: DeviceReading): boolean {
  // returns true if incoming is a duplicate (same device + timestamp within 30s, or same gravity+temp within 60s)
  return existing.some(e => {
    if (e.deviceId !== incoming.deviceId) return false;
    const dt = Math.abs(new Date(e.timestamp).getTime() - new Date(incoming.timestamp).getTime());
    if (dt <= 30_000) return true;
    if (e.gravity === incoming.gravity && e.temperatureC === incoming.temperatureC && dt <= 60_000) return true;
    return false;
  });
}

export function apparentAttenuation(og: number, currentSg: number): number {
  if (og <= 1 || currentSg < 1) return 0;
  return Math.max(0, Math.min(100, ((og - currentSg) / (og - 1)) * 100));
}

export function estimateAbv(og: number, currentSg: number, settings: AppSettings = defaultSettings): number {
  const fg = currentSg;
  return calculateAbv(og, fg, settings.abvFormula);
}

export type Trend = "falling" | "stable" | "rising" | "unknown";

export function gravityTrend(readings: DeviceReading[], windowHours = 6): Trend {
  const valid = readings.filter(r => r.valid && r.gravity !== undefined).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (valid.length < 2) return "unknown";
  const cutoff = Date.now() - windowHours * 3600_000;
  const recent = valid.filter(r => new Date(r.timestamp).getTime() >= cutoff);
  if (recent.length < 2) return "unknown";
  const first = recent[0].gravity!;
  const last = recent[recent.length - 1].gravity!;
  const delta = last - first;
  if (Math.abs(delta) < 0.001) return "stable";
  return delta < 0 ? "falling" : "rising";
}

export function isStabilized(readings: DeviceReading[], hours = 24, toleranceSg = 0.001): boolean {
  const valid = readings.filter(r => r.valid && r.gravity !== undefined).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  if (valid.length < 3) return false;
  const last = valid[valid.length - 1];
  const cutoff = new Date(last.timestamp).getTime() - hours * 3600_000;
  const window = valid.filter(r => new Date(r.timestamp).getTime() >= cutoff);
  if (window.length < 3) return false;
  const gs = window.map(r => r.gravity!);
  const min = Math.min(...gs);
  const max = Math.max(...gs);
  return (max - min) <= toleranceSg;
}

export function checkAlerts(config: AlertConfig, latest: DeviceReading | undefined, history: DeviceReading[], now = new Date()): AlertEvent[] {
  if (!config.enabled || !latest || !latest.valid) return [];
  const events: AlertEvent[] = [];
  const mk = (condition: string, message: string) => ({
    id: crypto.randomUUID(),
    batchId: config.batchId,
    configId: config.batchId,
    triggeredAt: now.toISOString(),
    condition,
    message,
    readingId: latest.id,
    dismissed: false,
  });

  if (config.tempMin !== undefined && latest.temperatureC !== undefined && latest.temperatureC < config.tempMin) {
    events.push(mk("temp_low", `Temperatura ${latest.temperatureC.toFixed(1)}°C abaixo do mínimo ${config.tempMin}°C`));
  }
  if (config.tempMax !== undefined && latest.temperatureC !== undefined && latest.temperatureC > config.tempMax) {
    events.push(mk("temp_high", `Temperatura ${latest.temperatureC.toFixed(1)}°C acima do máximo ${config.tempMax}°C`));
  }
  if (config.gravityMin !== undefined && latest.gravity !== undefined && latest.gravity < config.gravityMin) {
    events.push(mk("gravity_low", `Gravidade ${latest.gravity.toFixed(3)} abaixo do mínimo ${config.gravityMin}`));
  }
  if (config.gravityMax !== undefined && latest.gravity !== undefined && latest.gravity > config.gravityMax) {
    events.push(mk("gravity_high", `Gravidade ${latest.gravity.toFixed(3)} acima do máximo ${config.gravityMax}`));
  }

  // abnormal drop
  if (config.maxGravityDropPerHour !== undefined && history.length >= 2) {
    const prev = [...history].filter(r => r.valid && r.gravity !== undefined).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-2);
    if (prev && latest.gravity !== undefined && prev.gravity !== undefined) {
      const dtH = (new Date(latest.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 3600_000;
      if (dtH > 0) {
        const dropPerH = (prev.gravity - latest.gravity) / dtH;
        if (dropPerH > config.maxGravityDropPerHour) {
          events.push(mk("gravity_drop", `Queda de gravidade ${dropPerH.toFixed(4)} SG/h acima do limite ${config.maxGravityDropPerHour}`));
        }
      }
    }
  }

  // no reading
  if (config.noReadingMinutes !== undefined && history.length > 0) {
    const last = [...history].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).at(-1);
    if (last) {
      const mins = (now.getTime() - new Date(last.timestamp).getTime()) / 60_000;
      if (mins > config.noReadingMinutes) {
        events.push(mk("no_reading", `Sem leituras há ${Math.round(mins)} minutos`));
      }
    }
  }

  if (config.stabilizationHours !== undefined && isStabilized(history, config.stabilizationHours)) {
    events.push(mk("stabilized", `Fermentação estabilizada nas últimas ${config.stabilizationHours}h`));
  }

  return events;
}

export function dedupeAlerts(existing: AlertEvent[], incoming: AlertEvent[], minIntervalMinutes: number): AlertEvent[] {
  const accepted: AlertEvent[] = [];
  for (const ev of incoming) {
    const recent = existing.find(e => e.batchId === ev.batchId && e.condition === ev.condition && !e.dismissed && (new Date(ev.triggeredAt).getTime() - new Date(e.triggeredAt).getTime()) < minIntervalMinutes * 60_000);
    if (recent) continue;
    const dup = accepted.find(a => a.batchId === ev.batchId && a.condition === ev.condition);
    if (dup) continue;
    accepted.push(ev);
  }
  return accepted;
}