/**
 * Batch mode: read scenarios from a JSON or CSV file, run each one
 * (link budget + optional airtime), and collect per-row outcomes.
 * A bad row never aborts the batch — it is reported as an error outcome.
 *
 * JSON format: an array of scenario objects, or {"scenarios": [...]}.
 * CSV format: header row with the scenario field names
 * (name, txPowerDbm, frequencyMhz, distanceKm, sf, bandwidthKhz,
 * txAntennaGainDbi, rxAntennaGainDbi, txLossDb, rxLossDb, chip,
 * model, environment, requiredMarginDb, payloadBytes, codingRate).
 * Empty cells mean "use the default". Lines starting with '#' are comments.
 */
import { LoraError } from "./errors.js";
import { airtime } from "./airtime.js";
import { computeLinkBudget } from "./linkBudget.js";
import type { BatchOutcome, Scenario } from "./types.js";

const SCENARIO_NUMERIC_FIELDS = new Set([
  "txPowerDbm",
  "frequencyMhz",
  "distanceKm",
  "sf",
  "bandwidthKhz",
  "txAntennaGainDbi",
  "rxAntennaGainDbi",
  "txLossDb",
  "rxLossDb",
  "requiredMarginDb",
  "payloadBytes",
  "codingRate",
]);

function toNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new LoraError(
      "INVALID_VALUE",
      `Field ${field} = ${String(value)} is not a number.`,
    );
  }
  return n;
}

function normaliseScenario(raw: Record<string, unknown>): Scenario {
  const get = (field: string): unknown => raw[field];
  const num = (field: string): number | undefined =>
    toNumber(get(field), field);
  const str = (field: string): string | undefined => {
    const v = get(field);
    return v === undefined || v === null || v === "" ? undefined : String(v);
  };
  const name = str("name");
  if (name === undefined) {
    throw new LoraError("INVALID_VALUE", "Every scenario needs a name.");
  }
  const txPowerDbm = num("txPowerDbm");
  const frequencyMhz = num("frequencyMhz");
  const sf = num("sf");
  const bandwidthKhz = num("bandwidthKhz");
  if (
    txPowerDbm === undefined ||
    frequencyMhz === undefined ||
    sf === undefined ||
    bandwidthKhz === undefined
  ) {
    throw new LoraError(
      "INVALID_VALUE",
      `Scenario "${name}" is missing txPowerDbm, frequencyMhz, sf or bandwidthKhz.`,
    );
  }
  return {
    name,
    txPowerDbm,
    frequencyMhz,
    distanceKm: num("distanceKm"),
    sf: sf as Scenario["sf"],
    bandwidthKhz: bandwidthKhz as Scenario["bandwidthKhz"],
    txAntennaGainDbi: num("txAntennaGainDbi"),
    rxAntennaGainDbi: num("rxAntennaGainDbi"),
    txLossDb: num("txLossDb"),
    rxLossDb: num("rxLossDb"),
    chip: str("chip") as Scenario["chip"],
    model: str("model") as Scenario["model"],
    environment: str("environment") as Scenario["environment"],
    requiredMarginDb: num("requiredMarginDb"),
    payloadBytes: num("payloadBytes"),
    codingRate: num("codingRate") as Scenario["codingRate"],
  };
}

/** Parse batch scenarios from JSON text. */
export function parseBatchJson(text: string): Scenario[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new LoraError(
      "INVALID_VALUE",
      `Batch JSON is not valid JSON: ${(error as Error).message}`,
    );
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { scenarios?: unknown }).scenarios;
  if (!Array.isArray(list)) {
    throw new LoraError(
      "INVALID_VALUE",
      "Batch JSON must be an array of scenarios or {\"scenarios\": [...]}.",
    );
  }
  return list.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new LoraError(
        "INVALID_VALUE",
        `Scenario at index ${index} is not an object.`,
      );
    }
    return normaliseScenario(item as Record<string, unknown>);
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** Parse batch scenarios from CSV text. */
export function parseBatchCsv(text: string): Scenario[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (lines.length < 2) {
    throw new LoraError(
      "INVALID_VALUE",
      "Batch CSV needs a header row and at least one data row.",
    );
  }
  const header = splitCsvLine(lines[0] as string);
  const scenarios: Scenario[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const raw: Record<string, unknown> = {};
    header.forEach((field, index) => {
      const cell = cells[index] ?? "";
      raw[field] = SCENARIO_NUMERIC_FIELDS.has(field)
        ? cell === ""
          ? undefined
          : Number(cell)
        : cell;
    });
    scenarios.push(normaliseScenario(raw));
  }
  return scenarios;
}

/** Parse batch scenarios, auto-detecting JSON vs CSV from the text. */
export function parseBatch(text: string): Scenario[] {
  const trimmed = text.trimStart();
  return trimmed.startsWith("[") || trimmed.startsWith("{")
    ? parseBatchJson(text)
    : parseBatchCsv(text);
}

/** Run every scenario; a failing row yields an error outcome, not a crash. */
export function runBatch(scenarios: Scenario[]): BatchOutcome[] {
  return scenarios.map((scenario) => {
    try {
      const budget = computeLinkBudget({
        txPowerDbm: scenario.txPowerDbm,
        frequencyMhz: scenario.frequencyMhz,
        distanceKm: scenario.distanceKm ?? 1,
        sf: scenario.sf,
        bandwidthKhz: scenario.bandwidthKhz,
        txAntennaGainDbi: scenario.txAntennaGainDbi,
        rxAntennaGainDbi: scenario.rxAntennaGainDbi,
        txLossDb: scenario.txLossDb,
        rxLossDb: scenario.rxLossDb,
        chip: scenario.chip,
        model: scenario.model,
        environment: scenario.environment,
        requiredMarginDb: scenario.requiredMarginDb,
      });
      const outcome: BatchOutcome = { name: scenario.name, ok: true, budget };
      if (scenario.payloadBytes !== undefined) {
        outcome.airtime = airtime(
          {
            sf: scenario.sf,
            bandwidthKhz: scenario.bandwidthKhz,
            codingRate: scenario.codingRate,
          },
          scenario.payloadBytes,
        );
      }
      return outcome;
    } catch (error) {
      return {
        name: scenario.name,
        ok: false,
        error: (error as Error).message,
      };
    }
  });
}
