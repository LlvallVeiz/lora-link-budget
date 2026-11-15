/**
 * Tests for airtime.ts.
 *
 * Anchor values are hand-computed from the Semtech formulas and
 * cross-checked against published worked examples:
 * - SF7, 125 kHz, 20 B, CR 4/5, CRC on, explicit header, preamble 8:
 *   43 payload symbols, 44.032 ms payload + 12.544 ms preamble = 56.576 ms.
 * - SF12, 125 kHz, 64 B, CR 4/5: 73 payload symbols, total 2793.472 ms
 *   (published worked example, verified by independent calculators).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  airtime,
  dutyCycle,
  ldroRequired,
  payloadSymbolCount,
  symbolDurationMs,
} from "../src/airtime.js";

const approx = (actual: number, expected: number, tol: number): void => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );
};

test("symbol duration SF7/125 kHz is 1.024 ms, SF12/125 kHz 32.768 ms", () => {
  approx(symbolDurationMs(7, 125), 1.024, 1e-9);
  approx(symbolDurationMs(12, 125), 32.768, 1e-9);
  approx(symbolDurationMs(7, 250), 0.512, 1e-9);
});

test("LDRO is required only when Tsym exceeds 16 ms", () => {
  // Tsym: SF10/125 = 8.192 ms, SF11/125 = 16.384 ms, SF12/125 = 32.768 ms,
  // SF12/250 = 16.384 ms, SF11/250 = 8.192 ms, SF12/500 = 8.192 ms.
  assert.equal(ldroRequired(10, 125), false);
  assert.equal(ldroRequired(11, 125), true);
  assert.equal(ldroRequired(12, 125), true);
  assert.equal(ldroRequired(12, 250), true);
  assert.equal(ldroRequired(11, 250), false);
  assert.equal(ldroRequired(12, 500), false);
});

test("payload symbols for SF7/125 kHz/20 B is 43 (hand check)", () => {
  assert.equal(payloadSymbolCount(20, 7, 1, true, true, false), 43);
});

test("payload symbols for SF12/125 kHz/64 B is 73 (worked example)", () => {
  assert.equal(payloadSymbolCount(64, 12, 1, true, true, true), 73);
});

test("airtime SF7/125 kHz/20 B is 56.576 ms", () => {
  const r = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
  approx(r.totalMs, 56.576, 0.001);
  approx(r.preambleMs, 12.544, 0.001);
  approx(r.payloadMs, 44.032, 0.001);
  assert.equal(r.payloadSymbols, 43);
  assert.equal(r.ldro, false);
});

test("airtime SF12/125 kHz/64 B is 2793.472 ms (published example)", () => {
  const r = airtime({ sf: 12, bandwidthKhz: 125 }, 64);
  approx(r.totalMs, 2793.472, 0.001);
  assert.equal(r.payloadSymbols, 73);
  assert.equal(r.ldro, true);
});

test("implicit header shortens airtime, CRC off shortens it further", () => {
  const base = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
  const implicit = airtime(
    { sf: 7, bandwidthKhz: 125, explicitHeader: false },
    20,
  );
  const noCrc = airtime({ sf: 7, bandwidthKhz: 125, crc: false }, 20);
  assert.ok(implicit.totalMs < base.totalMs);
  assert.ok(noCrc.totalMs < base.totalMs);
});

test("stronger coding rate lengthens airtime", () => {
  const cr45 = airtime({ sf: 9, bandwidthKhz: 125, codingRate: 1 }, 50);
  const cr48 = airtime({ sf: 9, bandwidthKhz: 125, codingRate: 4 }, 50);
  assert.ok(cr48.totalMs > cr45.totalMs);
});

test("airtime grows with payload but in steps (symbol quantisation)", () => {
  const a = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
  const b = airtime({ sf: 7, bandwidthKhz: 125 }, 21);
  assert.equal(a.totalMs, b.totalMs);
  const c = airtime({ sf: 7, bandwidthKhz: 125 }, 30);
  assert.ok(c.totalMs > a.totalMs);
});

test("payload above the LoRaWAN maximum is flagged", () => {
  const r = airtime({ sf: 12, bandwidthKhz: 125 }, 100);
  assert.equal(r.maxLorawanPayloadBytes, 51);
  assert.equal(r.exceedsLorawanMax, true);
  const ok = airtime({ sf: 7, bandwidthKhz: 125 }, 100);
  assert.equal(ok.exceedsLorawanMax, false);
});

test("duty cycle 1%: min interval is 100x airtime", () => {
  const r = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
  const d = dutyCycle(r.totalMs, 0.01, "EU868");
  approx(d.minIntervalMs, 5657.6, 0.01);
  approx(d.maxPacketsPerHour, 3600000 / 5657.6, 0.01);
  assert.equal(d.dwellLimitMs, null);
  assert.equal(d.dwellExceeded, false);
});

test("US915 dwell limit: SF12/64 B packet exceeds 400 ms", () => {
  const r = airtime({ sf: 12, bandwidthKhz: 125 }, 64);
  const d = dutyCycle(r.totalMs, 1, "US915");
  assert.equal(d.dwellLimitMs, 400);
  assert.equal(d.dwellExceeded, true);
  const short = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
  assert.equal(dutyCycle(short.totalMs, 1, "US915").dwellExceeded, false);
});

test("invalid airtime inputs throw", () => {
  assert.throws(() => airtime({ sf: 7, bandwidthKhz: 125 }, 256), /payloadBytes/);
  assert.throws(() => airtime({ sf: 7, bandwidthKhz: 125 }, -1), /payloadBytes/);
  assert.throws(
    () => airtime({ sf: 7, bandwidthKhz: 125, codingRate: 5 as never }, 10),
    /codingRate/,
  );
  assert.throws(() => dutyCycle(100, 0, "EU868"), /dutyCycle/);
  assert.throws(() => dutyCycle(100, 2, "EU868"), /dutyCycle/);
});
