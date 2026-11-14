/// <reference types="node" />
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { RequestLimiter, parseRetryDelayMs, GeminiRateLimitError } from "./gemini";

test("bloqueia duas requisições com menos de 3s de intervalo", () => {
  const l = new RequestLimiter(10, 3000);
  l.acquire(0);
  assert.throws(() => l.acquire(1000), GeminiRateLimitError);
  assert.doesNotThrow(() => l.acquire(3000));
});
test("no máximo 10 requisições por minuto", () => {
  const l = new RequestLimiter(10, 0);
  for (let i = 0; i < 10; i++) l.acquire(i * 100);
  assert.equal(l.waitTime(5000), 55000);
  assert.equal(l.waitTime(60000), 0);
});
test("pausa após 429 respeita o tempo pedido pelo Google", () => {
  const l = new RequestLimiter();
  l.pauseFor(parseRetryDelayMs({ message: '"retryDelay": "23s"' })!, 0);
  assert.equal(l.waitTime(1000), 22000);
});
