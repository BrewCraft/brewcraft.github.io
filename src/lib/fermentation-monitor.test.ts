import test from "node:test";
import assert from "node:assert/strict";
import {
  validateReading, dedupeReadings, apparentAttenuation, gravityTrend, isStabilized, checkAlerts, dedupeAlerts,
  type DeviceReading,
} from "./fermentation-monitor";

const r = (over: Partial<DeviceReading>): DeviceReading => ({
  id: over.id ?? crypto.randomUUID(),
  deviceId: over.deviceId ?? "d1",
  deviceKind: over.deviceKind ?? "tilt",
  timestamp: over.timestamp ?? new Date().toISOString(),
  source: over.source ?? "automatic",
  valid: over.valid ?? true,
  ...over,
});

test("fermentation-monitor: validateReading rejeita gravidade inválida", () => {
  assert.equal(validateReading({ gravity: 0.5 }).valid, false);
  assert.equal(validateReading({ gravity: 1.05, temperatureC: 20 }).valid, true);
  assert.equal(validateReading({}).valid, false);
});

test("fermentation-monitor: dedupeReadings detecta duplicata por timestamp", () => {
  const t = new Date().toISOString();
  const a = r({ id: "a", timestamp: t, gravity: 1.05, temperatureC: 20 });
  const b = r({ id: "b", timestamp: t, gravity: 1.05, temperatureC: 20 });
  assert.equal(dedupeReadings([a], b), true);
});

test("fermentation-monitor: apparentAttenuation calcula corretamente", () => {
  assert.ok(Math.abs(apparentAttenuation(1.050, 1.010) - 80) < 0.01);
});

test("fermentation-monitor: gravityTrend falling", () => {
  const now = Date.now();
  const readings = [
    r({ timestamp: new Date(now - 2 * 3600_000).toISOString(), gravity: 1.050, valid: true }),
    r({ timestamp: new Date(now - 1 * 3600_000).toISOString(), gravity: 1.040, valid: true }),
  ];
  assert.equal(gravityTrend(readings), "falling");
});

test("fermentation-monitor: isStabilized true quando variação pequena", () => {
  const now = Date.now();
  const readings = [0, 1, 2].map(i => r({ timestamp: new Date(now - (2 - i) * 3600_000).toISOString(), gravity: 1.010, valid: true }));
  assert.equal(isStabilized(readings, 24, 0.001), true);
});

test("fermentation-monitor: checkAlerts dispara temp_high", () => {
  const rd = r({ gravity: 1.05, temperatureC: 25, valid: true });
  const ev = checkAlerts({ batchId: "b1", tempMax: 20, minIntervalMinutes: 30, enabled: true }, rd, [rd]);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].condition, "temp_high");
});

test("fermentation-monitor: dedupeAlerts respeita intervalo", () => {
  const now = new Date();
  const e1 = { id: "1", batchId: "b1", configId: "b1", triggeredAt: now.toISOString(), condition: "temp_high", message: "x", dismissed: false };
  const e2 = { ...e1, id: "2", triggeredAt: new Date(now.getTime() + 1000).toISOString() };
  const out = dedupeAlerts([e1], [e2], 30);
  assert.equal(out.length, 0);
});