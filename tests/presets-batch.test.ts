/**
 * Tests for presets.ts and batch.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { getPreset, listPresets, PRESETS } from "../src/presets.js";
import {
  parseBatchCsv,
  parseBatchJson,
  runBatch,
} from "../src/batch.js";

test("five presets exist and all reference a known chip", () => {
  const presets = listPresets();
  assert.equal(presets.length, 5);
  for (const p of presets) {
    assert.ok(p.chip === "sx1276" || p.chip === "sx1262");
    assert.ok(p.txPowerDbm > 0 && p.txPowerDbm <= 30);
  }
});

test("rfm95 preset: +20 dBm TX on the SX1276", () => {
  const p = getPreset("rfm95");
  assert.equal(p.chip, "sx1276");
  assert.equal(p.txPowerDbm, 20);
});

test("gateway preset has the highest antenna gain", () => {
  const g = getPreset("gateway");
  assert.equal(g.txAntennaGainDbi, 5);
  assert.equal(g.rxAntennaGainDbi, 5);
  assert.match(g.notes, /PLANNING PROXY/);
});

test("unknown preset throws with the valid ids listed", () => {
  assert.throws(() => getPreset("nope"), /preset/);
  assert.throws(() => getPreset("nope"), /rfm95/);
});

test("parseBatchJson accepts an array and a {scenarios} wrapper", () => {
  const text = JSON.stringify([
    { name: "a", txPowerDbm: 14, frequencyMhz: 868, sf: 7, bandwidthKhz: 125 },
  ]);
  assert.equal(parseBatchJson(text).length, 1);
  const wrapped = parseBatchJson(JSON.stringify({ scenarios: JSON.parse(text) }));
  assert.equal(wrapped.length, 1);
  assert.throws(() => parseBatchJson("{not json"), /not valid JSON/);
  assert.throws(() => parseBatchJson("{}"), /array of scenarios/);
});

test("parseBatchJson rejects a scenario missing required fields", () => {
  assert.throws(
    () =>
      parseBatchJson(
        JSON.stringify([{ name: "x", txPowerDbm: 14 }]),
      ),
    /missing/,
  );
  assert.throws(
    () => parseBatchJson(JSON.stringify([{ txPowerDbm: 14 }])),
    /name/,
  );
});

test("parseBatchCsv handles headers, comments and empty cells", () => {
  const csv = [
    "# comment line",
    "name,txPowerDbm,frequencyMhz,distanceKm,sf,bandwidthKhz,environment",
    "urban-sf7,14,868,1,7,125,urban",
    "rural-sf12,20,915,5,12,125,rural",
  ].join("\n");
  const scenarios = parseBatchCsv(csv);
  assert.equal(scenarios.length, 2);
  assert.equal(scenarios[0]?.name, "urban-sf7");
  assert.equal(scenarios[0]?.distanceKm, 1);
  assert.equal(scenarios[1]?.environment, "rural");
  assert.equal(scenarios[1]?.txAntennaGainDbi, undefined);
});

test("runBatch computes budgets and airtime, and isolates bad rows", () => {
  const outcomes = runBatch([
    {
      name: "good",
      txPowerDbm: 14,
      frequencyMhz: 868,
      distanceKm: 1,
      sf: 7,
      bandwidthKhz: 125,
      payloadBytes: 20,
    },
    {
      name: "bad-sf",
      txPowerDbm: 14,
      frequencyMhz: 868,
      distanceKm: 1,
      sf: 6 as never,
      bandwidthKhz: 125,
    },
  ]);
  assert.equal(outcomes.length, 2);
  assert.equal(outcomes[0]?.ok, true);
  assert.ok(outcomes[0]?.budget !== undefined);
  assert.ok(outcomes[0]?.airtime !== undefined);
  assert.ok(
    Math.abs((outcomes[0]?.airtime?.totalMs ?? 0) - 56.576) < 0.001,
  );
  assert.equal(outcomes[1]?.ok, false);
  assert.match(outcomes[1]?.error ?? "", /sf/);
});

test("runBatch without distance defaults to 1 km", () => {
  const [o] = runBatch([
    {
      name: "no-distance",
      txPowerDbm: 14,
      frequencyMhz: 868,
      sf: 7,
      bandwidthKhz: 125,
    },
  ]);
  assert.equal(o?.ok, true);
  assert.equal(o?.budget?.input.distanceKm, 1);
});
