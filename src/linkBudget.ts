/**
 * Link budget: EIRP, path loss, received power, link margin and the
 * PASS/FAIL verdict against the required fade margin, plus maximum-range
 * estimation per spreading factor.
 *
 *   EIRP        = Ptx + Gtx - Ltx
 *   Prx         = EIRP - Lpath + Grx - Lrx - Lmisc
 *   Link margin = Prx - Sensitivity(SF, BW, chip)
 *   Max path loss = Ptx + Gtx - Ltx + Grx - Lrx - Lmisc
 *                   - Sensitivity - required fade margin
 *
 * The verdict is a planning statement, not a guarantee: real links also
 * depend on antenna placement, interference, fading and the exact
 * receiver implementation. See docs/RESEARCH.md.
 */
import { rangeError, valueError } from "./errors.js";
import { maxRangeKm, pathLossDb } from "./pathloss.js";
import {
  assertBandwidthKhz,
  assertSpreadingFactor,
  dataRateBps,
  minSnrDb,
  sensitivityDbm,
  SPREADING_FACTORS,
} from "./sensitivity.js";
import type {
  Environment,
  LinkBudgetInput,
  LinkBudgetResult,
  PropagationModel,
  RangeRow,
} from "./types.js";

export const DEFAULT_REQUIRED_MARGIN_DB = 10;

export function resolveLinkBudgetInput(
  input: LinkBudgetInput,
): Required<LinkBudgetInput> {
  assertSpreadingFactor(input.sf);
  assertBandwidthKhz(input.bandwidthKhz);
  if (!Number.isFinite(input.txPowerDbm)) {
    throw rangeError("txPowerDbm", input.txPowerDbm, "finite dBm");
  }
  if (!Number.isFinite(input.frequencyMhz) || input.frequencyMhz <= 0) {
    throw rangeError("frequencyMhz", input.frequencyMhz, "> 0 MHz");
  }
  if (!Number.isFinite(input.distanceKm) || input.distanceKm <= 0) {
    throw rangeError("distanceKm", input.distanceKm, "> 0 km");
  }
  const model: PropagationModel = input.model ?? "log-distance";
  if (!["free-space", "log-distance", "hata"].includes(model)) {
    throw valueError("model", model, [
      "free-space",
      "log-distance",
      "hata",
    ]);
  }
  const environment: Environment = input.environment ?? "suburban";
  if (
    !["free-space", "rural", "suburban", "urban", "dense-urban"].includes(
      environment,
    )
  ) {
    throw valueError("environment", environment, [
      "free-space",
      "rural",
      "suburban",
      "urban",
      "dense-urban",
    ]);
  }
  return {
    txPowerDbm: input.txPowerDbm,
    frequencyMhz: input.frequencyMhz,
    distanceKm: input.distanceKm,
    sf: input.sf,
    bandwidthKhz: input.bandwidthKhz,
    txAntennaGainDbi: input.txAntennaGainDbi ?? 0,
    rxAntennaGainDbi: input.rxAntennaGainDbi ?? 0,
    txLossDb: input.txLossDb ?? 0,
    rxLossDb: input.rxLossDb ?? 0,
    chip: input.chip ?? "sx1276",
    miscLossDb: input.miscLossDb ?? 0,
    requiredMarginDb: input.requiredMarginDb ?? DEFAULT_REQUIRED_MARGIN_DB,
    model,
    environment,
    baseStationHeightM: input.baseStationHeightM ?? 30,
    mobileHeightM: input.mobileHeightM ?? 1.5,
  };
}

/** Full link-budget calculation for one link. */
export function computeLinkBudget(input: LinkBudgetInput): LinkBudgetResult {
  const i = resolveLinkBudgetInput(input);
  const sens = sensitivityDbm(i.chip, i.sf, i.bandwidthKhz);
  const eirpDbm = i.txPowerDbm + i.txAntennaGainDbi - i.txLossDb;
  const lossDb = pathLossDb(i.frequencyMhz, i.distanceKm, {
    model: i.model,
    environment: i.environment,
    baseStationHeightM: i.baseStationHeightM,
    mobileHeightM: i.mobileHeightM,
  });
  const receivedDbm =
    eirpDbm - lossDb + i.rxAntennaGainDbi - i.rxLossDb - i.miscLossDb;
  const linkMarginDb = receivedDbm - sens.valueDbm;
  const maxAllowablePathLossDb =
    i.txPowerDbm +
    i.txAntennaGainDbi -
    i.txLossDb +
    i.rxAntennaGainDbi -
    i.rxLossDb -
    i.miscLossDb -
    sens.valueDbm -
    i.requiredMarginDb;
  return {
    input: i,
    eirpDbm,
    pathLossDb: lossDb,
    receivedPowerDbm: receivedDbm,
    sensitivityDbm: sens.valueDbm,
    sensitivityInterpolated: sens.interpolated,
    linkMarginDb,
    marginAboveRequiredDb: linkMarginDb - i.requiredMarginDb,
    verdict: linkMarginDb >= i.requiredMarginDb ? "PASS" : "FAIL",
    maxAllowablePathLossDb,
    minSnrDb: minSnrDb(i.sf),
    dataRateBps: dataRateBps(i.sf, i.bandwidthKhz, 1),
  };
}

export interface RangeEstimateInput {
  txPowerDbm: number;
  frequencyMhz: number;
  bandwidthKhz: 125 | 250 | 500;
  txAntennaGainDbi?: number;
  rxAntennaGainDbi?: number;
  txLossDb?: number;
  rxLossDb?: number;
  chip?: "sx1276" | "sx1262";
  miscLossDb?: number;
  requiredMarginDb?: number;
  model?: PropagationModel;
  environment?: Environment;
  baseStationHeightM?: number;
  mobileHeightM?: number;
}

/**
 * Maximum range per spreading factor for one setup and one model.
 * One row per SF7..SF12; `maxRangeKm` is null when the range exceeds
 * the solver ceiling (100 km free-space/log-distance, 20 km Hata).
 */
export function estimateRange(
  input: RangeEstimateInput,
): RangeRow[] {
  const base: LinkBudgetInput = {
    ...input,
    distanceKm: 1,
    sf: 7,
  };
  const i = resolveLinkBudgetInput(base);
  return SPREADING_FACTORS.map((sf) => {
    const sens = sensitivityDbm(i.chip, sf, i.bandwidthKhz);
    const maxLossDb =
      i.txPowerDbm +
      i.txAntennaGainDbi -
      i.txLossDb +
      i.rxAntennaGainDbi -
      i.rxLossDb -
      i.miscLossDb -
      sens.valueDbm -
      i.requiredMarginDb;
    const solved = maxRangeKm(i.frequencyMhz, maxLossDb, {
      model: i.model,
      environment: i.environment,
      baseStationHeightM: i.baseStationHeightM,
      mobileHeightM: i.mobileHeightM,
    });
    return {
      sf,
      sensitivityDbm: sens.valueDbm,
      maxAllowablePathLossDb: maxLossDb,
      maxRangeKm: solved.rangeKm,
      capped: solved.capped,
    };
  });
}
