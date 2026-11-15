/**
 * Receiver sensitivity, minimum SNR, data rate and maximum payload.
 *
 * Sensitivity values are transcribed from the chip datasheets — see
 * docs/RESEARCH.md for the exact tables and their provenance:
 *
 * SX1276 (Semtech datasheet Rev. 5, Aug 2016, section 2.5.5, Band 1
 * "HF", split Rx/Tx path, highest LNA gain, LnaBoost) — full SF7..SF12
 * table for 125/250/500 kHz. Note the often-quoted "-137 dBm @ SF12 /
 * 125 kHz" is the Band 3 ("LF", 433 MHz) row; the HF (868/915 MHz) row
 * is -136 dBm. The code uses the HF row because 868/915 MHz are HF.
 *
 * SX1262 (Semtech datasheet, LoRa receiver characteristics, Rx boosted
 * gain) — the datasheet table only publishes the SF7 and SF12 endpoints
 * per bandwidth. SF8..SF11 are linearly interpolated in dB between those
 * endpoints and are flagged `interpolated: true`; treat them as planning
 * estimates, not datasheet values.
 *
 * Minimum SNR per SF is from Semtech AN1200.22 (LoRa Modem Designer's
 * Guide): SF7 -7.5 dB, stepping -2.5 dB per SF to SF12 -20 dB.
 *
 * LoRaWAN maximum MAC payloads are the EU868 data-rate table of the
 * LoRa Alliance Regional Parameters RP002; the raw LoRa PHY frame is
 * capped at 255 bytes (SX1276 packet engine, 256 bytes incl. header).
 */
import { LoraError, rangeError, valueError } from "./errors.js";
import type {
  BandwidthKhz,
  ChipId,
  Region,
  SpreadingFactor,
} from "./types.js";

export const SPREADING_FACTORS: readonly SpreadingFactor[] = [
  7, 8, 9, 10, 11, 12,
];
export const BANDWIDTHS_KHZ: readonly BandwidthKhz[] = [125, 250, 500];

/**
 * SX1276 sensitivity (dBm), Band 1 HF, from datasheet Rev. 5 §2.5.5.
 * Rows: bandwidth kHz; columns: SF7..SF12.
 */
export const SX1276_SENSITIVITY_DBM: Readonly<
  Record<BandwidthKhz, Readonly<Record<SpreadingFactor, number>>>
> = {
  125: { 7: -123, 8: -126, 9: -129, 10: -132, 11: -133, 12: -136 },
  250: { 7: -120, 8: -123, 9: -125, 10: -128, 11: -130, 12: -133 },
  500: { 7: -116, 8: -119, 9: -122, 10: -125, 11: -128, 12: -130 },
};

/**
 * SX1262 sensitivity endpoints (dBm) published in the datasheet
 * (Rx boosted gain): only SF7 and SF12 per bandwidth.
 */
export const SX1262_SENSITIVITY_ENDPOINTS_DBM: Readonly<
  Record<BandwidthKhz, Readonly<{ sf7: number; sf12: number }>>
> = {
  125: { sf7: -124, sf12: -137 },
  250: { sf7: -121, sf12: -134 },
  500: { sf7: -117, sf12: -129 },
};

/** Minimum required SNR per spreading factor, dB (AN1200.22). */
export const MIN_SNR_DB: Readonly<Record<SpreadingFactor, number>> = {
  7: -7.5,
  8: -10,
  9: -12.5,
  10: -15,
  11: -17.5,
  12: -20,
};

/**
 * LoRaWAN maximum MAC payload (bytes) per data rate, EU868 (RP002).
 * DR5..DR0 = SF7..SF12 at 125 kHz; DR6 = SF7 at 250 kHz.
 */
export const LORAWAN_MAX_PAYLOAD_EU868: Readonly<
  Record<string, number>
> = {
  "7-125": 222,
  "8-125": 222,
  "9-125": 115,
  "10-125": 51,
  "11-125": 51,
  "12-125": 51,
  "7-250": 222,
  "8-250": 222,
  "9-250": 222,
  "10-250": 222,
  "11-250": 222,
  "12-250": 222,
};

/** Maximum raw LoRa PHY payload, bytes (SX1276 packet engine limit). */
export const MAX_PHY_PAYLOAD_BYTES = 255;

export function assertSpreadingFactor(
  sf: number,
): asserts sf is SpreadingFactor {
  if (!SPREADING_FACTORS.includes(sf as SpreadingFactor)) {
    throw rangeError("sf", sf, "7..12 (integer)");
  }
}

export function assertBandwidthKhz(
  bw: number,
): asserts bw is BandwidthKhz {
  if (!BANDWIDTHS_KHZ.includes(bw as BandwidthKhz)) {
    throw valueError("bandwidthKhz", bw, ["125", "250", "500"]);
  }
}

export interface Sensitivity {
  /** Sensitivity in dBm. */
  valueDbm: number;
  /** True when the value was interpolated, not read from a datasheet. */
  interpolated: boolean;
  /** Where the value comes from. */
  source: string;
}

/**
 * Receiver sensitivity for a chip / SF / bandwidth.
 * SX1276 values are direct datasheet rows; SX1262 SF8..SF11 are
 * linearly interpolated between the published SF7/SF12 endpoints.
 */
export function sensitivityDbm(
  chip: ChipId,
  sf: SpreadingFactor,
  bandwidthKhz: BandwidthKhz,
): Sensitivity {
  assertSpreadingFactor(sf);
  assertBandwidthKhz(bandwidthKhz);
  if (chip === "sx1276") {
    return {
      valueDbm: SX1276_SENSITIVITY_DBM[bandwidthKhz][sf],
      interpolated: false,
      source: "SX1276 datasheet Rev. 5 §2.5.5 (Band 1 HF)",
    };
  }
  if (chip === "sx1262") {
    const ends = SX1262_SENSITIVITY_ENDPOINTS_DBM[bandwidthKhz];
    if (sf === 7) {
      return {
        valueDbm: ends.sf7,
        interpolated: false,
        source: "SX1262 datasheet, LoRa receiver characteristics",
      };
    }
    if (sf === 12) {
      return {
        valueDbm: ends.sf12,
        interpolated: false,
        source: "SX1262 datasheet, LoRa receiver characteristics",
      };
    }
    const valueDbm =
      ends.sf7 + ((ends.sf12 - ends.sf7) * (sf - 7)) / 5;
    return {
      valueDbm: Math.round(valueDbm * 10) / 10,
      interpolated: true,
      source:
        "SX1262 datasheet endpoints, linearly interpolated in dB (estimate)",
    };
  }
  throw valueError("chip", chip, ["sx1276", "sx1262"]);
}

/** Minimum required SNR for a spreading factor, dB. */
export function minSnrDb(sf: SpreadingFactor): number {
  assertSpreadingFactor(sf);
  return MIN_SNR_DB[sf];
}

/**
 * Nominal LoRa data rate in bit/s.
 * Rb = SF * (BW / 2^SF) * (4 / (4 + CR)), CR = coding-rate index 1..4.
 * Hand check: SF7, 125 kHz, CR 4/5 -> 5468.75 bit/s.
 */
export function dataRateBps(
  sf: SpreadingFactor,
  bandwidthKhz: BandwidthKhz,
  codingRateIndex: 1 | 2 | 3 | 4,
): number {
  assertSpreadingFactor(sf);
  assertBandwidthKhz(bandwidthKhz);
  if (![1, 2, 3, 4].includes(codingRateIndex)) {
    throw rangeError("codingRate", codingRateIndex, "1..4 (4/5..4/8)");
  }
  return (
    sf *
    ((bandwidthKhz * 1000) / Math.pow(2, sf)) *
    (4 / (4 + codingRateIndex))
  );
}

/**
 * Maximum LoRaWAN MAC payload in bytes for SF/BW.
 * Only EU868 (and AS923/AU915 share the same DR table shape) is
 * tabulated; other regions fall back to the EU868 table and the caller
 * is told so via the returned note. Raw PHY limit is 255 bytes.
 */
export function maxLorawanPayloadBytes(
  sf: SpreadingFactor,
  bandwidthKhz: BandwidthKhz,
  region: Region = "EU868",
): { bytes: number; note: string } {
  assertSpreadingFactor(sf);
  assertBandwidthKhz(bandwidthKhz);
  const key = `${sf}-${bandwidthKhz}`;
  const bytes = LORAWAN_MAX_PAYLOAD_EU868[key];
  if (bytes === undefined) {
    throw new LoraError(
      "UNSUPPORTED",
      `No LoRaWAN data rate for SF${sf} at ${bandwidthKhz} kHz.`,
    );
  }
  return {
    bytes,
    note:
      region === "EU868"
        ? "LoRa Alliance RP002, EU868 data-rate table"
        : `${region} uses the EU868-shaped table here; check the regional parameters for exact limits.`,
  };
}

/** Full sensitivity table for one chip, for the `sensitivity` command. */
export function sensitivityTable(
  chip: ChipId,
): Array<{
  sf: SpreadingFactor;
  bw125: Sensitivity;
  bw250: Sensitivity;
  bw500: Sensitivity;
}> {
  return SPREADING_FACTORS.map((sf) => ({
    sf,
    bw125: sensitivityDbm(chip, sf, 125),
    bw250: sensitivityDbm(chip, sf, 250),
    bw500: sensitivityDbm(chip, sf, 500),
  }));
}
