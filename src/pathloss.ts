/**
 * Propagation models: free-space path loss (Friis), log-distance and
 * Okumura-Hata, plus maximum-range solving by bisection.
 *
 * Sources (see docs/RESEARCH.md):
 * - FSPL: Friis transmission equation, PL(dB) = 20log10(d) + 20log10(f)
 *   + 32.44 with d in km and f in MHz.
 * - Log-distance: Rappaport, "Wireless Communications: Principles and
 *   Practice", ch. 3 — PL(d) = PL(d0) + 10 n log10(d/d0). The exponents
 *   below are the typical values from Rappaport Table 3.2 (free space 2;
 *   urban cellular 2.7-3.5; shadowed urban 3-5) rounded to one planning
 *   value per environment; they are user-overridable, not measurements.
 * - Okumura-Hata: Hata (1980), IEEE Trans. Veh. Technol. VT-29(3),
 *   valid for f 150-1500 MHz, hb 30-200 m, hm 1-10 m, d 1-20 km.
 */
import { LoraError, rangeError } from "./errors.js";
import type { Environment, PropagationModel } from "./types.js";

/** Path-loss exponent per environment (log-distance model). */
export const ENVIRONMENT_EXPONENTS: Readonly<Record<Environment, number>> = {
  "free-space": 2.0,
  rural: 2.5,
  suburban: 2.9,
  urban: 3.4,
  "dense-urban": 4.0,
};

/** Human-readable description of each environment class. */
export const ENVIRONMENT_DESCRIPTIONS: Readonly<Record<Environment, string>> = {
  "free-space": "line of sight, no obstructions (n = 2.0)",
  rural: "open / rural terrain, few obstructions (n = 2.5)",
  suburban: "suburban, low buildings and trees (n = 2.9)",
  urban: "urban, medium buildings (n = 3.4)",
  "dense-urban": "dense urban, high-rise shadowing (n = 4.0)",
};

/** Reference distance for the log-distance model, km (1 m). */
export const LOG_DISTANCE_REFERENCE_KM = 0.001;

/** Ceiling of the range solver, km — beyond this the answer is ">100 km". */
export const RANGE_SOLVER_MAX_KM = 100;

function checkFrequencyMhz(frequencyMhz: number): void {
  if (!Number.isFinite(frequencyMhz) || frequencyMhz <= 0) {
    throw rangeError("frequencyMhz", frequencyMhz, "> 0 MHz");
  }
}

function checkDistanceKm(distanceKm: number): void {
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    throw rangeError("distanceKm", distanceKm, "> 0 km");
  }
}

/**
 * Free-space path loss (Friis) in dB.
 * FSPL = 20*log10(d_km) + 20*log10(f_MHz) + 32.44
 *
 * Hand check: 868 MHz, 1 km -> 32.44 + 58.77 + 0 = 91.21 dB.
 */
export function freeSpacePathLossDb(
  frequencyMhz: number,
  distanceKm: number,
): number {
  checkFrequencyMhz(frequencyMhz);
  checkDistanceKm(distanceKm);
  return (
    20 * Math.log10(distanceKm) +
    20 * Math.log10(frequencyMhz) +
    32.44
  );
}

/**
 * Log-distance path loss in dB, anchored on free-space loss at 1 m.
 * PL(d) = FSPL(d0) + 10 * n * log10(d / d0), d0 = 1 m.
 */
export function logDistancePathLossDb(
  frequencyMhz: number,
  distanceKm: number,
  exponent: number,
): number {
  checkFrequencyMhz(frequencyMhz);
  checkDistanceKm(distanceKm);
  if (!Number.isFinite(exponent) || exponent <= 0) {
    throw rangeError("exponent", exponent, "> 0");
  }
  const referenceLossDb = freeSpacePathLossDb(
    frequencyMhz,
    LOG_DISTANCE_REFERENCE_KM,
  );
  return (
    referenceLossDb +
    10 * exponent * Math.log10(distanceKm / LOG_DISTANCE_REFERENCE_KM)
  );
}

/** Mobile-station height correction a(hm) for a small/medium city (Hata). */
function hataMobileCorrectionDb(
  frequencyMhz: number,
  mobileHeightM: number,
): number {
  const logF = Math.log10(frequencyMhz);
  return (
    (1.1 * logF - 0.7) * mobileHeightM - (1.56 * logF - 0.8)
  );
}

/**
 * Okumura-Hata median path loss in dB.
 *
 * Urban:    L = 69.55 + 26.16 log10(f) - 13.82 log10(hb) - a(hm)
 *               + (44.9 - 6.55 log10(hb)) log10(d)
 * Suburban: L_sub = L_urban - 2 [log10(f/28)]^2 - 5.4
 * Rural:    L_rur = L_urban - 4.78 (log10 f)^2 + 18.33 log10(f) - 40.94
 * with f in MHz, hb/hm in m, d in km.
 *
 * Throws LoraError outside the model's validity box
 * (f 150-1500 MHz, hb 30-200 m, hm 1-10 m, d 1-20 km).
 */
export function hataPathLossDb(
  frequencyMhz: number,
  distanceKm: number,
  baseStationHeightM: number,
  mobileHeightM: number,
  area: "urban" | "suburban" | "rural",
): number {
  checkFrequencyMhz(frequencyMhz);
  checkDistanceKm(distanceKm);
  if (frequencyMhz < 150 || frequencyMhz > 1500) {
    throw new LoraError(
      "OUT_OF_RANGE",
      `Okumura-Hata is valid for 150-1500 MHz, got ${frequencyMhz} MHz.`,
    );
  }
  if (baseStationHeightM < 30 || baseStationHeightM > 200) {
    throw rangeError(
      "baseStationHeightM",
      baseStationHeightM,
      "30-200 m (Okumura-Hata validity)",
    );
  }
  if (mobileHeightM < 1 || mobileHeightM > 10) {
    throw rangeError(
      "mobileHeightM",
      mobileHeightM,
      "1-10 m (Okumura-Hata validity)",
    );
  }
  if (distanceKm < 1 || distanceKm > 20) {
    throw rangeError(
      "distanceKm",
      distanceKm,
      "1-20 km (Okumura-Hata validity)",
    );
  }
  const logF = Math.log10(frequencyMhz);
  const logHb = Math.log10(baseStationHeightM);
  const urbanLossDb =
    69.55 +
    26.16 * logF -
    13.82 * logHb -
    hataMobileCorrectionDb(frequencyMhz, mobileHeightM) +
    (44.9 - 6.55 * logHb) * Math.log10(distanceKm);
  if (area === "urban") return urbanLossDb;
  if (area === "suburban") {
    return urbanLossDb - 2 * Math.pow(Math.log10(frequencyMhz / 28), 2) - 5.4;
  }
  return (
    urbanLossDb - 4.78 * Math.pow(logF, 2) + 18.33 * logF - 40.94
  );
}

/** Map a log-distance environment onto the Hata area class. */
export function hataAreaForEnvironment(
  environment: Environment,
): "urban" | "suburban" | "rural" {
  if (environment === "rural" || environment === "free-space") return "rural";
  if (environment === "suburban") return "suburban";
  return "urban";
}

export interface PathLossOptions {
  model: PropagationModel;
  environment: Environment;
  baseStationHeightM: number;
  mobileHeightM: number;
}

/**
 * Path loss in dB for one link, dispatching on the chosen model.
 * 'free-space' ignores the environment; 'hata' maps the environment
 * onto its urban/suburban/rural area classes.
 */
export function pathLossDb(
  frequencyMhz: number,
  distanceKm: number,
  options: PathLossOptions,
): number {
  switch (options.model) {
    case "free-space":
      return freeSpacePathLossDb(frequencyMhz, distanceKm);
    case "log-distance":
      return logDistancePathLossDb(
        frequencyMhz,
        distanceKm,
        ENVIRONMENT_EXPONENTS[options.environment],
      );
    case "hata":
      return hataPathLossDb(
        frequencyMhz,
        distanceKm,
        options.baseStationHeightM,
        options.mobileHeightM,
        hataAreaForEnvironment(options.environment),
      );
  }
}

/**
 * Maximum range in km at which the path loss reaches `maxLossDb`,
 * solved by bisection (path loss grows monotonically with distance).
 * Returns null when the range exceeds RANGE_SOLVER_MAX_KM (100 km).
 *
 * For Hata the search is clamped to its 1-20 km validity box; a result
 * beyond 20 km is reported as capped at 20 km.
 */
export function maxRangeKm(
  frequencyMhz: number,
  maxLossDb: number,
  options: PathLossOptions,
): { rangeKm: number | null; capped: boolean } {
  checkFrequencyMhz(frequencyMhz);
  if (!Number.isFinite(maxLossDb)) {
    throw rangeError("maxLossDb", maxLossDb, "finite dB");
  }
  const hiKm =
    options.model === "hata" ? 20 : RANGE_SOLVER_MAX_KM;
  const loKm = options.model === "hata" ? 1 : 0.001;
  if (pathLossDb(frequencyMhz, hiKm, options) <= maxLossDb) {
    return { rangeKm: null, capped: true };
  }
  if (pathLossDb(frequencyMhz, loKm, options) >= maxLossDb) {
    return { rangeKm: loKm, capped: false };
  }
  let lo = loKm;
  let hi = hiKm;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (pathLossDb(frequencyMhz, mid, options) < maxLossDb) lo = mid;
    else hi = mid;
  }
  return { rangeKm: (lo + hi) / 2, capped: false };
}
