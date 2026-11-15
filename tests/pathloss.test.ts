/**
 * Tests for propagation models (pathloss.ts).
 *
 * Anchor values are hand-computed from the defining formulas:
 * - FSPL(868 MHz, 1 km) = 32.44 + 20*log10(868) = 91.21 dB
 * - FSPL(915 MHz, 10 km) = 32.44 + 20*log10(915) + 20 = 111.67 dB
 * - Hata urban (868 MHz, 2 km, hb 30 m, hm 1.5 m) = 136.60 dB
 *   (69.55 + 26.16*log10(868) - 13.82*log10(30) - a(hm)
 *    + (44.9 - 6.55*log10(30))*log10(2), a(hm) = 0.0146 dB)
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  ENVIRONMENT_EXPONENTS,
  freeSpacePathLossDb,
  hataPathLossDb,
  logDistancePathLossDb,
  maxRangeKm,
  pathLossDb,
} from "../src/pathloss.js";

const approx = (actual: number, expected: number, tol: number): void => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} dB of ${expected}`,
  );
};

test("FSPL at 868 MHz / 1 km is 91.21 dB (hand check)", () => {
  approx(freeSpacePathLossDb(868, 1), 91.21, 0.01);
});

test("FSPL at 915 MHz / 10 km is 111.67 dB", () => {
  approx(freeSpacePathLossDb(915, 10), 111.67, 0.01);
});

test("FSPL doubles by 6.02 dB when distance doubles", () => {
  const a = freeSpacePathLossDb(868, 1);
  const b = freeSpacePathLossDb(868, 2);
  approx(b - a, 6.02, 0.01);
});

test("FSPL at 433 MHz is lower than at 868 MHz for the same distance", () => {
  assert.ok(freeSpacePathLossDb(433, 1) < freeSpacePathLossDb(868, 1));
  approx(
    freeSpacePathLossDb(868, 1) - freeSpacePathLossDb(433, 1),
    6.04,
    0.01,
  );
});

test("log-distance at the 1 m reference equals FSPL at 1 m", () => {
  const freq = 868;
  approx(
    logDistancePathLossDb(freq, 0.001, 2.5),
    freeSpacePathLossDb(freq, 0.001),
    1e-9,
  );
});

test("log-distance with n = 2 matches free space at any distance", () => {
  for (const d of [0.1, 1, 5, 20]) {
    approx(
      logDistancePathLossDb(868, d, 2.0),
      freeSpacePathLossDb(868, d),
      1e-9,
    );
  }
});

test("log-distance loss grows with the environment exponent", () => {
  const rural = logDistancePathLossDb(868, 5, ENVIRONMENT_EXPONENTS.rural);
  const urban = logDistancePathLossDb(868, 5, ENVIRONMENT_EXPONENTS.urban);
  const dense = logDistancePathLossDb(
    868,
    5,
    ENVIRONMENT_EXPONENTS["dense-urban"],
  );
  assert.ok(rural < urban && urban < dense);
});

test("Hata urban at 868 MHz / 2 km is 136.60 dB (hand check)", () => {
  approx(hataPathLossDb(868, 2, 30, 1.5, "urban"), 136.6, 0.05);
});

test("Hata suburban and rural are below urban at the same distance", () => {
  const urban = hataPathLossDb(868, 5, 30, 1.5, "urban");
  const suburban = hataPathLossDb(868, 5, 30, 1.5, "suburban");
  const rural = hataPathLossDb(868, 5, 30, 1.5, "rural");
  assert.ok(suburban < urban && rural < suburban);
  approx(urban - suburban, 9.85, 0.05);
  approx(urban - rural, 28.35, 0.05);
});

test("Hata loss grows when the base-station antenna is lowered", () => {
  assert.ok(
    hataPathLossDb(868, 5, 30, 1.5, "urban") >
      hataPathLossDb(868, 5, 100, 1.5, "urban"),
  );
});

test("pathLossDb dispatches on the model", () => {
  const base = {
    environment: "urban" as const,
    baseStationHeightM: 30,
    mobileHeightM: 1.5,
  };
  approx(
    pathLossDb(868, 2, { ...base, model: "free-space" }),
    freeSpacePathLossDb(868, 2),
    1e-9,
  );
  approx(
    pathLossDb(868, 2, { ...base, model: "log-distance" }),
    logDistancePathLossDb(868, 2, ENVIRONMENT_EXPONENTS.urban),
    1e-9,
  );
  approx(
    pathLossDb(868, 2, { ...base, model: "hata" }),
    hataPathLossDb(868, 2, 30, 1.5, "urban"),
    1e-9,
  );
});

test("maxRangeKm inverts free-space path loss", () => {
  const loss = freeSpacePathLossDb(868, 3.5);
  const { rangeKm, capped } = maxRangeKm(868, loss, {
    model: "free-space",
    environment: "free-space",
    baseStationHeightM: 30,
    mobileHeightM: 1.5,
  });
  assert.equal(capped, false);
  assert.ok(rangeKm !== null);
  approx(rangeKm, 3.5, 0.001);
});

test("maxRangeKm returns capped when the loss budget is huge", () => {
  const { rangeKm, capped } = maxRangeKm(868, 500, {
    model: "free-space",
    environment: "free-space",
    baseStationHeightM: 30,
    mobileHeightM: 1.5,
  });
  assert.equal(rangeKm, null);
  assert.equal(capped, true);
});

test("maxRangeKm is capped at 20 km for Hata", () => {
  const { rangeKm, capped } = maxRangeKm(868, 200, {
    model: "hata",
    environment: "urban",
    baseStationHeightM: 30,
    mobileHeightM: 1.5,
  });
  assert.equal(rangeKm, null);
  assert.equal(capped, true);
});

test("invalid inputs throw LoraError with a clear message", () => {
  assert.throws(() => freeSpacePathLossDb(868, 0), /distanceKm/);
  assert.throws(() => freeSpacePathLossDb(-1, 1), /frequencyMhz/);
  assert.throws(() => logDistancePathLossDb(868, 1, 0), /exponent/);
  assert.throws(() => hataPathLossDb(2400, 2, 30, 1.5, "urban"), /150-1500/);
  assert.throws(() => hataPathLossDb(868, 0.5, 30, 1.5, "urban"), /1-20 km/);
  assert.throws(() => hataPathLossDb(868, 2, 10, 1.5, "urban"), /30-200 m/);
});
