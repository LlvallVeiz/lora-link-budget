/**
 * Shared types for lora-link-budget.
 *
 * Conventions used across the package:
 * - Powers in dBm, gains/losses/path loss in dB, frequencies in MHz,
 *   distances in km (path-loss helpers) or metres where the name says so.
 * - Spreading factor 7..12, bandwidth 125/250/500 kHz — the SX127x
 *   parameter space this tool models (SF6, FSK and LR-FHSS are out of scope).
 */

/** LoRa spreading factor supported by this tool (SF7..SF12). */
export type SpreadingFactor = 7 | 8 | 9 | 10 | 11 | 12;

/** LoRa channel bandwidth in kHz. */
export type BandwidthKhz = 125 | 250 | 500;

/** Radio chip whose datasheet sensitivity table is used. */
export type ChipId = "sx1276" | "sx1262";

/** Environment class for the log-distance model. */
export type Environment =
  | "free-space"
  | "rural"
  | "suburban"
  | "urban"
  | "dense-urban";

/** Propagation model used to turn distance into path loss. */
export type PropagationModel = "free-space" | "log-distance" | "hata";

/** Regulatory region, used for duty-cycle / dwell-time checks. */
export type Region = "EU868" | "US915" | "AS923" | "AU915";

/** LoRa coding rate, stored as the CR index 1..4 (4/5 .. 4/8). */
export type CodingRateIndex = 1 | 2 | 3 | 4;

/** PHY settings of one LoRa packet. */
export interface RadioSettings {
  /** Spreading factor 7..12. */
  sf: SpreadingFactor;
  /** Channel bandwidth in kHz. */
  bandwidthKhz: BandwidthKhz;
  /** Coding-rate index 1..4 = 4/5..4/8. Default 1 (4/5). */
  codingRate?: CodingRateIndex;
  /** Programmed preamble length in symbols. Default 8. */
  preambleSymbols?: number;
  /** Payload CRC present. Default true. */
  crc?: boolean;
  /** Explicit header (false = implicit header, no header transmitted). Default true. */
  explicitHeader?: boolean;
  /**
   * Low data rate optimisation. 'auto' (default) turns it on when the
   * symbol duration exceeds 16 ms, per Semtech's recommendation.
   */
  ldro?: "auto" | boolean;
}

/** Inputs for a single link-budget calculation. */
export interface LinkBudgetInput {
  /** Transmit power at the radio output, dBm. */
  txPowerDbm: number;
  /** Carrier frequency, MHz (e.g. 868 or 915). */
  frequencyMhz: number;
  /** Link distance, km. */
  distanceKm: number;
  /** Spreading factor of the link. */
  sf: SpreadingFactor;
  /** Channel bandwidth in kHz. */
  bandwidthKhz: BandwidthKhz;
  /** Transmit antenna gain, dBi. Default 0. */
  txAntennaGainDbi?: number;
  /** Receive antenna gain, dBi. Default 0. */
  rxAntennaGainDbi?: number;
  /** Cable/connector loss on the TX side, dB. Default 0. */
  txLossDb?: number;
  /** Cable/connector loss on the RX side, dB. Default 0. */
  rxLossDb?: number;
  /** Chip whose sensitivity table is used. Default 'sx1276'. */
  chip?: ChipId;
  /** Extra loss budget (miscellaneous / implementation margin), dB. Default 0. */
  miscLossDb?: number;
  /** Required fade margin for a PASS verdict, dB. Default 10. */
  requiredMarginDb?: number;
  /** Propagation model. Default 'log-distance'. */
  model?: PropagationModel;
  /** Environment class (log-distance / Hata). Default 'suburban'. */
  environment?: Environment;
  /** Base-station antenna height in metres (Hata only). Default 30. */
  baseStationHeightM?: number;
  /** Mobile/node antenna height in metres (Hata only). Default 1.5. */
  mobileHeightM?: number;
}

/** Result of a single link-budget calculation. */
export interface LinkBudgetResult {
  input: Required<LinkBudgetInput>;
  /** EIRP = TX power + TX antenna gain − TX loss, dBm. */
  eirpDbm: number;
  /** Path loss from the chosen propagation model, dB. */
  pathLossDb: number;
  /** Received power at the receiver input, dBm. */
  receivedPowerDbm: number;
  /** Receiver sensitivity for this SF/BW/chip, dBm. */
  sensitivityDbm: number;
  /** True when the sensitivity value was interpolated, not read from a datasheet. */
  sensitivityInterpolated: boolean;
  /** Link margin = received power − sensitivity, dB. */
  linkMarginDb: number;
  /** Margin left after the required fade margin, dB. */
  marginAboveRequiredDb: number;
  /** 'PASS' when linkMarginDb >= requiredMarginDb. */
  verdict: "PASS" | "FAIL";
  /** Maximum tolerable path loss for this setup, dB. */
  maxAllowablePathLossDb: number;
  /** Minimum required SNR for this SF, dB (AN1200.22). */
  minSnrDb: number;
  /** Nominal data rate for this SF/BW/CR, bit/s. */
  dataRateBps: number;
}

/** One row of a range estimate (maximum range for one SF). */
export interface RangeRow {
  sf: SpreadingFactor;
  sensitivityDbm: number;
  maxAllowablePathLossDb: number;
  /** Maximum range in km, or null when it exceeds the solver ceiling (100 km). */
  maxRangeKm: number | null;
  /** True when the range is limited by the solver ceiling, not by the link. */
  capped: boolean;
}

/** Result of an airtime calculation for one packet. */
export interface AirtimeResult {
  settings: Required<RadioSettings> & { payloadBytes: number };
  /** One symbol duration, ms. */
  symbolDurationMs: number;
  /** Low data rate optimisation actually applied. */
  ldro: boolean;
  /** Preamble time, ms (includes the 4.25-symbol radio overhead). */
  preambleMs: number;
  /** Number of payload symbols. */
  payloadSymbols: number;
  /** Payload time, ms. */
  payloadMs: number;
  /** Total time on air, ms. */
  totalMs: number;
  /** Nominal data rate, bit/s. */
  dataRateBps: number;
  /** Maximum LoRaWAN MAC payload for this SF/BW in the region, bytes. */
  maxLorawanPayloadBytes: number;
  /** True when payloadBytes exceeds the LoRaWAN maximum for this SF. */
  exceedsLorawanMax: boolean;
}

/** Duty-cycle / dwell-time assessment for a packet. */
export interface DutyCycleResult {
  airtimeMs: number;
  dutyCycleFraction: number;
  /** Minimum silent time between two identical packets, ms. */
  minIntervalMs: number;
  /** Maximum packets per hour at this duty cycle. */
  maxPacketsPerHour: number;
  /** US915 dwell-time limit (400 ms) applies. */
  dwellLimitMs: number | null;
  /** True when the packet exceeds the dwell-time limit. */
  dwellExceeded: boolean;
}

/** A named device preset (radio + antenna + losses). */
export interface DevicePreset {
  id: string;
  name: string;
  description: string;
  chip: ChipId;
  txPowerDbm: number;
  txAntennaGainDbi: number;
  txLossDb: number;
  rxAntennaGainDbi: number;
  rxLossDb: number;
  notes: string;
}

/** One scenario in a batch / compare file. */
export interface Scenario {
  name: string;
  txPowerDbm: number;
  frequencyMhz: number;
  distanceKm?: number;
  sf: SpreadingFactor;
  bandwidthKhz: BandwidthKhz;
  txAntennaGainDbi?: number;
  rxAntennaGainDbi?: number;
  txLossDb?: number;
  rxLossDb?: number;
  chip?: ChipId;
  model?: PropagationModel;
  environment?: Environment;
  requiredMarginDb?: number;
  /** Optional airtime block for this scenario. */
  payloadBytes?: number;
  codingRate?: CodingRateIndex;
}

/** Outcome of running one batch scenario. */
export interface BatchOutcome {
  name: string;
  ok: boolean;
  error?: string;
  budget?: LinkBudgetResult;
  airtime?: AirtimeResult;
}
