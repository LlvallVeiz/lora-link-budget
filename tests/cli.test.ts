/**
 * CLI smoke tests: spawn the compiled CLI and check real stdout.
 * These run after `tsc` (npm test builds first), so they exercise the
 * actual shipped entry point, not the TypeScript sources.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const CLI = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/cli.js",
);

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("budget prints a PASS verdict for a short urban SF12 link", () => {
  const r = runCli([
    "budget", "--preset", "rfm95", "--freq", "868", "--distance", "2",
    "--sf", "12", "--bw", "125", "--env", "urban",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Link margin\s+\+14\.55 dB/);
  assert.match(r.stdout, /Verdict\s+PASS/);
});

test("budget --json returns parseable JSON with the same numbers", () => {
  const r = runCli([
    "budget", "--preset", "rfm95", "--freq", "868", "--distance", "2",
    "--sf", "12", "--bw", "125", "--env", "urban", "--json",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout) as { linkMarginDb: number; verdict: string };
  assert.ok(Math.abs(parsed.linkMarginDb - 14.55) < 0.05);
  assert.equal(parsed.verdict, "PASS");
});

test("range lists SF7..SF12 with rural SF12 near 29.6 km", () => {
  const r = runCli([
    "range", "--preset", "sx1276-node", "--freq", "868", "--bw", "125",
    "--model", "log-distance", "--env", "rural",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SF12/);
  assert.match(r.stdout, /29\.6\d? km/);
});

test("airtime prints 56.576 ms for SF7/125 kHz/20 B", () => {
  const r = runCli([
    "airtime", "--sf", "7", "--bw", "125", "--payload", "20", "--duty", "0.01",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Total airtime\s+56\.576 ms/);
  assert.match(r.stdout, /min interval 5657\.600 ms/);
});

test("airtime SF12/64 B warns about the US915 dwell limit", () => {
  const r = runCli([
    "airtime", "--sf", "12", "--bw", "125", "--payload", "64",
    "--region", "US915",
  ]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Total airtime\s+2793\.472 ms/);
  assert.match(r.stdout, /EXCEEDED/);
});

test("presets lists all five presets", () => {
  const r = runCli(["presets"]);
  assert.equal(r.status, 0, r.stderr);
  for (const id of ["sx1276-node", "rfm95", "sx1262-node", "esp32-lora", "gateway"]) {
    assert.ok(r.stdout.includes(id), `missing preset ${id}`);
  }
});

test("sensitivity prints the SX1276 table with -136 dBm at SF12/125 kHz", () => {
  const r = runCli(["sensitivity", "--chip", "sx1276"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SF12\s+-136\.0/);
});

test("invalid SF exits non-zero with a clear error", () => {
  const r = runCli(["budget", "--tx", "14", "--freq", "868", "--distance", "1", "--sf", "6", "--bw", "125"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sf/);
});

test("unknown command exits non-zero with usage hint", () => {
  const r = runCli(["frobnicate"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Unknown command/);
});

test("--help prints usage and exits zero", () => {
  const r = runCli(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /lora-link-budget/);
  assert.match(r.stdout, /budget/);
});
