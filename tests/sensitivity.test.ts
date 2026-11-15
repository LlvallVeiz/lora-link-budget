/**
 * Tests for sensitivity.ts.
 *
 * Anchor values are transcribed from the datasheets (see
 * docs/RESEARCH.md): SX1276 Rev. 5 §2.5.5 (Band 1 HF) and the SX1262
 * LoRa receiver characteristics (SF7/SF12 endpoints per bandwidth).
 * Minimum SNR is AN1200.22; data rates are the closed-form formula
 * checked against the textbook SF7/125 kHz value of 5468.75 bit/s.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  dataRateBps,
  maxLorawanPayloadBytes,
  minSnrDb,
  sensitivityDbm,
  sensitivityTable,
} from "../src/sensitivity.js";
import type { SpreadingFactor } from "../src/types.js";

test("SX1276 sensitivity at 125 kHz matches the datasheet table", () => {
  const expected: Array<[SpreadingFactor, number]> = [
    [7, -123], [8, -126], [9, -129], [10, -132], [11, -133], [12, -136],
  ];
  for (const [sf, dbm] of expected) {
    const s = sensitivityDbm("sx1276", sf, 125);
    assert.equal(s.valueDbm, dbm, `SF${sf}/125 kHz`);
    assert.equal(s.interpolated, false);
  }
});

test("SX1276 SF12 sensitivity falls as bandwidth rises", () => {
  assert.equal(sensitivityDbm("sx1276", 12, 125).valueDbm, -136);
  assert.equal(sensitivityDbm("sx1276", 12, 250).valueDbm, -133);
  assert.equal(sensitivityDbm("sx1276", 12, 500).valueDbm, -130);
});

test("SX1276 SF7 at 250 kHz is -120 dBm, at 500 kHz -116 dBm", () => {
  assert.equal(sensitivityDbm("sx1276", 7, 250).valueDbm, -120);
  assert.equal(sensitivityDbm("sx1276", 7, 500).valueDbm, -116);
});

test("SX1262 endpoints match the datasheet and are not interpolated", () => {
  assert.deepEqual(sensitivityDbm("sx1262", 7, 125), {
    valueDbm: -124,
    interpolated: false,
    source: "SX1262 datasheet, LoRa receiver characteristics",
  });
  assert.equal(sensitivityDbm("sx1262", 12, 125).valueDbm, -137);
  assert.equal(sensitivityDbm("sx1262", 12, 250).valueDbm, -134);
  assert.equal(sensitivityDbm("sx1262", 12, 500).valueDbm, -129);
  assert.equal(sensitivityDbm("sx1262", 7, 500).valueDbm, -117);
});

test("SX1262 intermediate SFs are flagged as interpolated", () => {
  const s = sensitivityDbm("sx1262", 9, 125);
  assert.equal(s.interpolated, true);
  // Linear interpolation between -124 (SF7) and -137 (SF12): -129.2.
  assert.equal(s.valueDbm, -129.2);
  assert.match(s.source, /interpolated/);
});

test("SX1262 is more sensitive than SX1276 at the same SF/BW", () => {
  for (const sf of [7, 12] as const) {
    assert.ok(
      sensitivityDbm("sx1262", sf, 125).valueDbm <
        sensitivityDbm("sx1276", sf, 125).valueDbm,
    );
  }
});

test("minimum SNR steps -2.5 dB per SF (AN1200.22)", () => {
  assert.equal(minSnrDb(7), -7.5);
  assert.equal(minSnrDb(9), -12.5);
  assert.equal(minSnrDb(12), -20);
});

test("data rate SF7/125 kHz/CR 4/5 is 5468.75 bit/s", () => {
  assert.equal(dataRateBps(7, 125, 1), 5468.75);
});

test("data rate SF12/125 kHz/CR 4/5 is 293 bit/s", () => {
  assert.ok(Math.abs(dataRateBps(12, 125, 1) - 292.97) < 0.01);
});

test("data rate doubles when bandwidth doubles", () => {
  assert.equal(dataRateBps(7, 250, 1), 2 * dataRateBps(7, 125, 1));
});

test("stronger coding rate lowers the data rate", () => {
  assert.ok(dataRateBps(7, 125, 4) < dataRateBps(7, 125, 1));
});

test("LoRaWAN max payload: DR0 (SF12) 51 B, DR5 (SF7) 222 B", () => {
  assert.equal(maxLorawanPayloadBytes(12, 125).bytes, 51);
  assert.equal(maxLorawanPayloadBytes(7, 125).bytes, 222);
  assert.equal(maxLorawanPayloadBytes(9, 125).bytes, 115);
});

test("sensitivityTable covers all SFs and bandwidths", () => {
  const table = sensitivityTable("sx1276");
  assert.equal(table.length, 6);
  assert.equal(table[0]?.sf, 7);
  assert.equal(table[5]?.bw125.valueDbm, -136);
});

test("invalid SF / bandwidth / chip throw", () => {
  assert.throws(() => sensitivityDbm("sx1276", 6 as never, 125), /sf/);
  assert.throws(() => sensitivityDbm("sx1276", 7, 62 as never), /bandwidth/);
  assert.throws(
    () => sensitivityDbm("sx1280" as never, 7, 125),
    /chip/,
  );
});
