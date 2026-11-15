/**
 * Tests for linkBudget.ts.
 *
 * Anchor: RFM95 preset at 868 MHz, 2 km, SF12/125 kHz, urban
 * log-distance (n = 3.4). Hand check:
 *   EIRP = 20 + 2 - 1 = 21 dBm
 *   FSPL(1 m) = 32.44 + 58.77 - 60 = 31.21 dB
 *   PL(2 km) = 31.21 + 34*log10(2000) = 31.21 + 34*3.30103 = 143.45 dB
 *   Prx = 21 - 143.45 + 2 - 1 = -121.45 dBm
 *   Sensitivity SF12/125 kHz (SX1276) = -136 dBm
 *   Margin = -121.45 - (-136) = 14.55 dB -> PASS at 10 dB required.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeLinkBudget,
  estimateRange,
} from "../src/linkBudget.js";

const approx = (actual: number, expected: number, tol: number): void => {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`,
  );
};

const RFM95_URBAN_SF12 = {
  txPowerDbm: 20,
  frequencyMhz: 868,
  distanceKm: 2,
  sf: 12 as const,
  bandwidthKhz: 125 as const,
  txAntennaGainDbi: 2,
  rxAntennaGainDbi: 2,
  txLossDb: 1,
  rxLossDb: 1,
  chip: "sx1276" as const,
  model: "log-distance" as const,
  environment: "urban" as const,
};

test("RFM95 urban 2 km SF12 budget matches the hand check", () => {
  const r = computeLinkBudget(RFM95_URBAN_SF12);
  approx(r.eirpDbm, 21, 1e-9);
  approx(r.pathLossDb, 143.45, 0.05);
  approx(r.receivedPowerDbm, -121.45, 0.05);
  assert.equal(r.sensitivityDbm, -136);
  approx(r.linkMarginDb, 14.55, 0.05);
  assert.equal(r.verdict, "PASS");
  assert.equal(r.minSnrDb, -20);
});

test("same link at SF7 fails: sensitivity is 13 dB worse", () => {
  const r = computeLinkBudget({ ...RFM95_URBAN_SF12, sf: 7 as const });
  assert.equal(r.sensitivityDbm, -123);
  approx(r.linkMarginDb, 1.55, 0.05);
  assert.equal(r.verdict, "FAIL");
});

test("a closer link passes at SF7", () => {
  const r = computeLinkBudget({
    ...RFM95_URBAN_SF12,
    sf: 7 as const,
    distanceKm: 0.5,
  });
  assert.equal(r.verdict, "PASS");
});

test("free-space model gives a much better margin than urban log-distance", () => {
  const fs = computeLinkBudget({
    ...RFM95_URBAN_SF12,
    model: "free-space" as const,
  });
  const urban = computeLinkBudget(RFM95_URBAN_SF12);
  assert.ok(fs.linkMarginDb > urban.linkMarginDb);
  approx(fs.pathLossDb, 97.23, 0.05);
});

test("Hata urban at 2 km matches the path-loss module", () => {
  const r = computeLinkBudget({
    ...RFM95_URBAN_SF12,
    model: "hata" as const,
  });
  approx(r.pathLossDb, 136.6, 0.05);
  assert.equal(r.verdict, "PASS");
});

test("max allowable path loss is margin-consistent", () => {
  const r = computeLinkBudget(RFM95_URBAN_SF12);
  approx(
    r.maxAllowablePathLossDb,
    r.pathLossDb + r.linkMarginDb - 10,
    1e-9,
  );
});

test("range: rural SF12 beats urban SF12, and SF12 beats SF7", () => {
  const base = {
    txPowerDbm: 14,
    frequencyMhz: 868,
    bandwidthKhz: 125 as const,
    txAntennaGainDbi: 2,
    rxAntennaGainDbi: 2,
    txLossDb: 0.5,
    rxLossDb: 0.5,
    chip: "sx1276" as const,
    model: "log-distance" as const,
  };
  const rural = estimateRange({ ...base, environment: "rural" });
  const urban = estimateRange({ ...base, environment: "urban" });
  assert.equal(rural.length, 6);
  assert.equal(urban.length, 6);
  const ruralSf12 = rural[5]!.maxRangeKm;
  const urbanSf12 = urban[5]!.maxRangeKm;
  const ruralSf7 = rural[0]!.maxRangeKm;
  assert.ok(ruralSf12 !== null && urbanSf12 !== null && ruralSf7 !== null);
  assert.ok(ruralSf12 > urbanSf12);
  assert.ok(ruralSf12 > ruralSf7);
  // Rural SF12 at 14 dBm TX: ~29.6 km (hand check: allowed loss 143 dB,
  // PL(1 m) 31.21 dB, n = 2.5 -> 10^((143-31.21)/25) km).
  approx(ruralSf12, 29.6, 1.0);
  // Urban SF12 at 14 dBm TX: ~1.94 km (n = 3.4).
  approx(urbanSf12, 1.94, 0.2);
});

test("range with free-space model exceeds the 100 km ceiling (capped)", () => {
  const rows = estimateRange({
    txPowerDbm: 20,
    frequencyMhz: 868,
    bandwidthKhz: 125,
    txAntennaGainDbi: 2,
    rxAntennaGainDbi: 2,
    model: "free-space",
    environment: "free-space",
  });
  const sf12 = rows[5];
  assert.equal(sf12?.maxRangeKm, null);
  assert.equal(sf12?.capped, true);
});

test("SX1262 node reaches farther than SX1276 at the same power", () => {
  const common = {
    txPowerDbm: 14,
    frequencyMhz: 868,
    bandwidthKhz: 125 as const,
    model: "log-distance" as const,
    environment: "suburban" as const,
  };
  const a = estimateRange({ ...common, chip: "sx1276" });
  const b = estimateRange({ ...common, chip: "sx1262" });
  assert.ok((b[5]?.maxRangeKm ?? 0) > (a[5]?.maxRangeKm ?? 0));
});

test("invalid link-budget inputs throw", () => {
  assert.throws(
    () => computeLinkBudget({ ...RFM95_URBAN_SF12, distanceKm: 0 }),
    /distanceKm/,
  );
  assert.throws(
    () => computeLinkBudget({ ...RFM95_URBAN_SF12, sf: 6 as never }),
    /sf/,
  );
  assert.throws(
    () =>
      computeLinkBudget({
        ...RFM95_URBAN_SF12,
        model: "itu" as never,
      }),
    /model/,
  );
});
