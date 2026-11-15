/**
 * Report formatting: fixed-width text tables for the terminal and
 * JSON output for scripting. All numbers are rendered with the
 * locale-independent helpers in units.ts.
 */
import {
  formatBps,
  formatDb,
  formatDbm,
  formatKm,
  formatMs,
  formatPercent,
} from "./units.js";
import type {
  AirtimeResult,
  BatchOutcome,
  DevicePreset,
  DutyCycleResult,
  LinkBudgetResult,
  RangeRow,
} from "./types.js";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function divider(width: number): string {
  return "-".repeat(width);
}

/** One-line summary of a link-budget result. */
export function formatBudgetSummary(result: LinkBudgetResult): string {
  const i = result.input;
  const lines = [
    `Link budget — ${i.frequencyMhz} MHz, SF${i.sf}, ${i.bandwidthKhz} kHz, ${i.chip.toUpperCase()}, ${i.model}/${i.environment}, ${i.distanceKm} km`,
    `  EIRP            ${formatDbm(result.eirpDbm)}`,
    `  Path loss       ${formatDb(result.pathLossDb)}`,
    `  Received power  ${formatDbm(result.receivedPowerDbm)}`,
    `  Sensitivity     ${formatDbm(result.sensitivityDbm)}${result.sensitivityInterpolated ? " (interpolated — see docs/RESEARCH.md)" : ""}`,
    `  Link margin     ${formatDb(result.linkMarginDb)}`,
    `  Required margin ${formatDb(i.requiredMarginDb)}`,
    `  Verdict         ${result.verdict}${result.verdict === "PASS" ? ` (margin above required: ${formatDb(result.marginAboveRequiredDb)})` : ` (short by ${formatDb(-result.marginAboveRequiredDb)})`}`,
    `  Max path loss   ${formatDb(result.maxAllowablePathLossDb)}`,
    `  Min SNR (SF${i.sf})  ${formatDb(result.minSnrDb)}`,
    `  Data rate       ${formatBps(result.dataRateBps)} (CR 4/5)`,
  ];
  return lines.join("\n");
}

/** Table of maximum range per spreading factor. */
export function formatRangeTable(
  rows: RangeRow[],
  header: string,
): string {
  const lines = [
    header,
    `${pad("SF", 5)}${pad("Sensitivity", 14)}${pad("Max path loss", 15)}${pad("Max range", 12)}`,
    divider(46),
  ];
  for (const row of rows) {
    lines.push(
      `${pad(`SF${row.sf}`, 5)}${pad(formatDbm(row.sensitivityDbm), 14)}${pad(formatDb(row.maxAllowablePathLossDb), 15)}${pad(formatKm(row.maxRangeKm), 12)}`,
    );
  }
  return lines.join("\n");
}

/** Airtime breakdown for one packet. */
export function formatAirtime(
  result: AirtimeResult,
  duty: DutyCycleResult | null,
): string {
  const s = result.settings;
  const lines = [
    `Time on air — SF${s.sf}, ${s.bandwidthKhz} kHz, ${s.payloadBytes} B payload, CR 4/${s.codingRate + 4}, preamble ${s.preambleSymbols}, CRC ${s.crc ? "on" : "off"}, ${s.explicitHeader ? "explicit" : "implicit"} header, LDRO ${result.ldro ? "on" : "off"}`,
    `  Symbol duration ${formatMs(result.symbolDurationMs)}`,
    `  Preamble        ${formatMs(result.preambleMs)}`,
    `  Payload symbols ${result.payloadSymbols}`,
    `  Payload time    ${formatMs(result.payloadMs)}`,
    `  Total airtime   ${formatMs(result.totalMs)}`,
    `  Data rate       ${formatBps(result.dataRateBps)}`,
    `  LoRaWAN max payload (SF${s.sf}/${s.bandwidthKhz} kHz)  ${result.maxLorawanPayloadBytes} B${result.exceedsLorawanMax ? "  <-- payload exceeds LoRaWAN max" : ""}`,
  ];
  if (duty !== null) {
    lines.push(
      `  Duty cycle      ${formatPercent(duty.dutyCycleFraction)} -> min interval ${formatMs(duty.minIntervalMs)}, max ${duty.maxPacketsPerHour.toFixed(1)} packets/hour`,
    );
    if (duty.dwellLimitMs !== null) {
      lines.push(
        `  Dwell limit     ${formatMs(duty.dwellLimitMs)} ${duty.dwellExceeded ? "<-- EXCEEDED by this packet" : "(ok)"}`,
      );
    }
  }
  return lines.join("\n");
}

/** Comparison table across batch outcomes. */
export function formatCompareTable(outcomes: BatchOutcome[]): string {
  const lines = [
    `${pad("Scenario", 28)}${pad("SF", 5)}${pad("Prx", 13)}${pad("Margin", 11)}${pad("Verdict", 9)}${pad("Airtime", 12)}`,
    divider(78),
  ];
  for (const o of outcomes) {
    if (!o.ok || o.budget === undefined) {
      lines.push(`${pad(o.name, 28)}ERROR: ${o.error ?? "unknown error"}`);
      continue;
    }
    const b = o.budget;
    lines.push(
      `${pad(o.name, 28)}${pad(`SF${b.input.sf}`, 5)}${pad(formatDbm(b.receivedPowerDbm), 13)}${pad(formatDb(b.linkMarginDb), 11)}${pad(b.verdict, 9)}${pad(o.airtime ? formatMs(o.airtime.totalMs) : "-", 12)}`,
    );
  }
  return lines.join("\n");
}

/** Device preset table. */
export function formatPresets(presets: DevicePreset[]): string {
  const lines = [
    `${pad("ID", 14)}${pad("Chip", 9)}${pad("TX", 9)}${pad("TX ant", 9)}${pad("RX ant", 9)}Name`,
    divider(78),
  ];
  for (const p of presets) {
    lines.push(
      `${pad(p.id, 14)}${pad(p.chip, 9)}${pad(formatDbm(p.txPowerDbm, 0), 9)}${pad(formatDb(p.txAntennaGainDbi, "dB", 0), 9)}${pad(formatDb(p.rxAntennaGainDbi, "dB", 0), 9)}${p.name}`,
    );
  }
  return lines.join("\n");
}

/** Sensitivity table for one chip. */
export function formatSensitivityTable(
  chip: string,
  rows: Array<{
    sf: number;
    bw125: { valueDbm: number; interpolated: boolean };
    bw250: { valueDbm: number; interpolated: boolean };
    bw500: { valueDbm: number; interpolated: boolean };
  }>,
): string {
  const lines = [
    `Receiver sensitivity (dBm) — ${chip.toUpperCase()}`,
    `${pad("SF", 5)}${pad("125 kHz", 11)}${pad("250 kHz", 11)}${pad("500 kHz", 11)}`,
    divider(38),
  ];
  for (const r of rows) {
    const cell = (s: { valueDbm: number; interpolated: boolean }): string =>
      `${s.valueDbm.toFixed(1)}${s.interpolated ? "*" : ""}`;
    lines.push(
      `${pad(`SF${r.sf}`, 5)}${pad(cell(r.bw125), 11)}${pad(cell(r.bw250), 11)}${pad(cell(r.bw500), 11)}`,
    );
  }
  lines.push("* interpolated between published SF7/SF12 endpoints (estimate)");
  return lines.join("\n");
}

/** Stable JSON output (2-space indent, trailing newline). */
export function toJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
