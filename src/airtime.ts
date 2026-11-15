/**
 * LoRa time-on-air, from the Semtech formulas (AN1200.13 / AN1200.22,
 * "LoRa Modem Designer's Guide", and the SX1276 datasheet §4.1.1):
 *
 *   Tsym    = 2^SF / BW
 *   Tpre    = (Npreamble + 4.25) * Tsym
 *   Npay    = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*H)
 *               / (4 * (SF - 2*DE))) * (CR + 4), 0)
 *   Tpay    = Npay * Tsym
 *   Tpacket = Tpre + Tpay
 *
 * PL = payload bytes, CRC = 1 when the payload CRC is on, H = 1 for
 * implicit header (no header) and 0 for explicit header, DE = 1 when
 * low data rate optimisation is on, CR = 1..4 for coding rate 4/5..4/8.
 * Semtech recommends DE = 1 when Tsym > 16 ms ('auto' mode here).
 *
 * Cross-checks (see tests/airtime.test.ts):
 * - SF7, 125 kHz, 20 B, CR 4/5, CRC on, explicit header -> 56.576 ms
 *   (43 payload symbols: 44.032 ms + 12.544 ms preamble).
 * - SF12, 125 kHz, 64 B, CR 4/5 -> 2793.472 ms (published worked
 *   example, cross-checked against independent calculators).
 *
 * Duty cycle: EU868 imposes 1% (ETSI EN 300 220, sub-band dependent);
 * US915 has no duty cycle but a 400 ms dwell-time limit per hop (FCC
 * Part 15.247). Both are checked here as planning aids, not legal advice.
 */
import { rangeError } from "./errors.js";
import {
  assertBandwidthKhz,
  assertSpreadingFactor,
  dataRateBps,
  maxLorawanPayloadBytes,
  MAX_PHY_PAYLOAD_BYTES,
} from "./sensitivity.js";
import type {
  AirtimeResult,
  CodingRateIndex,
  DutyCycleResult,
  RadioSettings,
  Region,
} from "./types.js";

/** Symbol duration above which low data rate optimisation is required. */
export const LDRO_THRESHOLD_MS = 16;

/** US915 dwell-time limit per transmission, ms (FCC Part 15.247). */
export const US915_DWELL_LIMIT_MS = 400;

/** Default EU868 duty-cycle limit (ETSI EN 300 220, 1%). */
export const EU868_DUTY_CYCLE = 0.01;

export function resolveSettings(
  settings: RadioSettings,
  payloadBytes: number,
): Required<RadioSettings> & { payloadBytes: number } {
  assertSpreadingFactor(settings.sf);
  assertBandwidthKhz(settings.bandwidthKhz);
  if (
    !Number.isInteger(payloadBytes) ||
    payloadBytes < 0 ||
    payloadBytes > MAX_PHY_PAYLOAD_BYTES
  ) {
    throw rangeError(
      "payloadBytes",
      payloadBytes,
      `0..${MAX_PHY_PAYLOAD_BYTES} (integer bytes)`,
    );
  }
  const codingRate = settings.codingRate ?? 1;
  if (![1, 2, 3, 4].includes(codingRate)) {
    throw rangeError("codingRate", codingRate, "1..4 (4/5..4/8)");
  }
  const preambleSymbols = settings.preambleSymbols ?? 8;
  if (
    !Number.isInteger(preambleSymbols) ||
    preambleSymbols < 6 ||
    preambleSymbols > 65535
  ) {
    throw rangeError("preambleSymbols", preambleSymbols, "6..65535");
  }
  return {
    sf: settings.sf,
    bandwidthKhz: settings.bandwidthKhz,
    codingRate: codingRate as CodingRateIndex,
    preambleSymbols,
    crc: settings.crc ?? true,
    explicitHeader: settings.explicitHeader ?? true,
    ldro: settings.ldro ?? "auto",
    payloadBytes,
  };
}

/** One LoRa symbol duration in ms: Tsym = 2^SF / BW. */
export function symbolDurationMs(
  sf: number,
  bandwidthKhz: number,
): number {
  assertSpreadingFactor(sf);
  assertBandwidthKhz(bandwidthKhz);
  return (Math.pow(2, sf) / (bandwidthKhz * 1000)) * 1000;
}

/** Whether low data rate optimisation is required (Tsym > 16 ms). */
export function ldroRequired(
  sf: number,
  bandwidthKhz: number,
): boolean {
  return symbolDurationMs(sf, bandwidthKhz) > LDRO_THRESHOLD_MS;
}

/**
 * Number of payload symbols, Semtech formula.
 * H = 0 explicit header / 1 implicit header; DE = 0/1 LDRO.
 */
export function payloadSymbolCount(
  payloadBytes: number,
  sf: number,
  codingRateIndex: number,
  crc: boolean,
  explicitHeader: boolean,
  ldro: boolean,
): number {
  const numerator =
    8 * payloadBytes -
    4 * sf +
    28 +
    16 * (crc ? 1 : 0) -
    20 * (explicitHeader ? 0 : 1);
  const denominator = 4 * (sf - 2 * (ldro ? 1 : 0));
  const blocks = Math.max(
    Math.ceil(numerator / denominator) * (codingRateIndex + 4),
    0,
  );
  return 8 + blocks;
}

/** Full time-on-air calculation for one packet. */
export function airtime(
  settings: RadioSettings,
  payloadBytes: number,
  region: Region = "EU868",
): AirtimeResult {
  const s = resolveSettings(settings, payloadBytes);
  const tsymMs = symbolDurationMs(s.sf, s.bandwidthKhz);
  const ldro =
    s.ldro === "auto" ? ldroRequired(s.sf, s.bandwidthKhz) : s.ldro;
  const payloadSymbols = payloadSymbolCount(
    s.payloadBytes,
    s.sf,
    s.codingRate,
    s.crc,
    s.explicitHeader,
    ldro,
  );
  const preambleMs = (s.preambleSymbols + 4.25) * tsymMs;
  const payloadMs = payloadSymbols * tsymMs;
  const maxPayload = maxLorawanPayloadBytes(
    s.sf,
    s.bandwidthKhz,
    region,
  );
  return {
    settings: s,
    symbolDurationMs: tsymMs,
    ldro,
    preambleMs,
    payloadSymbols,
    payloadMs,
    totalMs: preambleMs + payloadMs,
    dataRateBps: dataRateBps(s.sf, s.bandwidthKhz, s.codingRate),
    maxLorawanPayloadBytes: maxPayload.bytes,
    exceedsLorawanMax: s.payloadBytes > maxPayload.bytes,
  };
}

/**
 * Duty-cycle assessment: minimum gap between packets and the maximum
 * packets per hour at the given duty-cycle fraction, plus the US915
 * 400 ms dwell-time check when the region is US915/AU915.
 */
export function dutyCycle(
  airtimeMs: number,
  dutyCycleFraction: number,
  region: Region = "EU868",
): DutyCycleResult {
  if (!(airtimeMs > 0) || !Number.isFinite(airtimeMs)) {
    throw rangeError("airtimeMs", airtimeMs, "> 0 ms");
  }
  if (
    !Number.isFinite(dutyCycleFraction) ||
    dutyCycleFraction <= 0 ||
    dutyCycleFraction > 1
  ) {
    throw rangeError("dutyCycle", dutyCycleFraction, "0 < duty cycle <= 1");
  }
  const minIntervalMs = airtimeMs / dutyCycleFraction;
  const dwellLimitMs =
    region === "US915" || region === "AU915" ? US915_DWELL_LIMIT_MS : null;
  return {
    airtimeMs,
    dutyCycleFraction,
    minIntervalMs,
    maxPacketsPerHour: 3_600_000 / minIntervalMs,
    dwellLimitMs,
    dwellExceeded:
      dwellLimitMs !== null ? airtimeMs > dwellLimitMs : false,
  };
}
