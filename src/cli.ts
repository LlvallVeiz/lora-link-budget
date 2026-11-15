#!/usr/bin/env node
/**
 * CLI for lora-link-budget.
 *
 *   lora-link-budget budget     --tx 14 --freq 868 --distance 2 --sf 12 --bw 125 [--preset sx1276-node] [--model log-distance] [--env urban] [--json]
 *   lora-link-budget range      --tx 14 --freq 868 --bw 125 [--preset ...] [--model ...] [--env ...] [--json]
 *   lora-link-budget airtime    --sf 7 --bw 125 --payload 20 [--cr 1] [--duty 0.01] [--region EU868] [--json]
 *   lora-link-budget compare    --file scenarios.json [--json]
 *   lora-link-budget batch      --input scenarios.csv --output results.json
 *   lora-link-budget presets
 *   lora-link-budget sensitivity [--chip sx1276]
 *
 * No runtime dependencies; argument parsing is hand-rolled so the tool
 * stays a single compiled bundle.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { airtime, dutyCycle, EU868_DUTY_CYCLE } from "./airtime.js";
import { parseBatch, runBatch } from "./batch.js";
import { LoraError } from "./errors.js";
import { computeLinkBudget, estimateRange } from "./linkBudget.js";
import { getPreset, listPresets } from "./presets.js";
import {
  formatAirtime,
  formatBudgetSummary,
  formatCompareTable,
  formatPresets,
  formatRangeTable,
  formatSensitivityTable,
  toJson,
} from "./report.js";
import { sensitivityTable } from "./sensitivity.js";
import type {
  BandwidthKhz,
  ChipId,
  Environment,
  PropagationModel,
  Region,
  SpreadingFactor,
} from "./types.js";

const VERSION = "1.0.0";

const HELP = `lora-link-budget ${VERSION} — LoRa link budget, range and time-on-air calculator

Usage:
  lora-link-budget <command> [options]

Commands:
  budget       Link budget for one link (EIRP, path loss, received power, margin)
  range        Maximum range per spreading factor (SF7..SF12)
  airtime      Time on air for one packet (Semtech formula)
  compare      Compare scenarios from a JSON/CSV file (table or JSON)
  batch        Run a batch file and write the results to a file
  presets      List built-in device presets
  sensitivity  Print the receiver sensitivity table for a chip

Common options:
  --tx <dBm>          Transmit power, dBm (budget/range)
  --freq <MHz>        Carrier frequency, MHz, e.g. 868 or 915
  --distance <km>     Link distance, km (budget)
  --sf <7..12>        Spreading factor
  --bw <125|250|500>  Channel bandwidth, kHz
  --cr <1..4>         Coding rate 4/5..4/8 (airtime, default 1)
  --payload <bytes>   Payload size, bytes (airtime)
  --preset <id>       Device preset (budget/range): sx1276-node, rfm95,
                      sx1262-node, esp32-lora, gateway
  --gtx <dBi>         TX antenna gain (default 0, or preset value)
  --grx <dBi>         RX antenna gain (default 0, or preset value)
  --ltx <dB>          TX cable/connector loss (default 0)
  --lrx <dB>          RX cable/connector loss (default 0)
  --chip <sx1276|sx1262>  Sensitivity table (default sx1276)
  --model <free-space|log-distance|hata>  Propagation model (default log-distance)
  --env <free-space|rural|suburban|urban|dense-urban>  Environment (default suburban)
  --margin <dB>       Required fade margin (default 10)
  --duty <fraction>   Duty cycle, e.g. 0.01 for 1% (airtime)
  --region <EU868|US915|AS923|AU915>  Region for duty/dwell checks (default EU868)
  --file <path>       Scenario file for compare
  --input <path>      Batch input file (JSON or CSV)
  --output <path>     Batch output file (JSON)
  --json              Machine-readable JSON output
  --help              Show this help
  --version           Show the version

Examples:
  lora-link-budget budget --preset rfm95 --freq 868 --distance 2 --sf 12 --bw 125 --env urban
  lora-link-budget range --preset sx1262-node --freq 915 --bw 125 --model log-distance --env rural
  lora-link-budget airtime --sf 7 --bw 125 --payload 20 --duty 0.01
  lora-link-budget compare --file examples/batch-scenarios.json
`;

type Options = Record<string, string | boolean>;

function parseArgs(argv: string[]): { command: string; options: Options } {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }
  const options: Options = {};
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (!arg.startsWith("--")) {
      throw new LoraError(
        "INVALID_VALUE",
        `Unexpected argument "${arg}". Options use --name value.`,
      );
    }
    const key = arg.slice(2);
    if (key === "json" || key === "help") {
      options[key] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new LoraError(
        "INVALID_VALUE",
        `Option --${key} needs a value.`,
      );
    }
    options[key] = value;
    i++;
  }
  if (options["help"] === true) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  return { command, options };
}

function num(options: Options, key: string): number | undefined {
  const raw = options[key];
  if (raw === undefined || typeof raw !== "boolean") {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new LoraError(
        "INVALID_VALUE",
        `--${key} = "${raw}" is not a number.`,
      );
    }
    return n;
  }
  throw new LoraError("INVALID_VALUE", `--${key} needs a value.`);
}

function requiredNum(options: Options, key: string): number {
  const value = num(options, key);
  if (value === undefined) {
    throw new LoraError(
      "INVALID_VALUE",
      `Missing required option --${key}.`,
    );
  }
  return value;
}

function str(options: Options, key: string): string | undefined {
  const raw = options[key];
  if (raw === undefined) return undefined;
  if (typeof raw === "boolean") {
    throw new LoraError("INVALID_VALUE", `--${key} needs a value.`);
  }
  return raw;
}

function applyPreset(
  options: Options,
): { chip: ChipId; tx: number; gtx: number; grx: number; ltx: number; lrx: number } {
  const presetId = str(options, "preset");
  const preset = presetId === undefined ? null : getPreset(presetId);
  return {
    chip: (str(options, "chip") as ChipId | undefined) ??
      preset?.chip ??
      "sx1276",
    tx: num(options, "tx") ?? preset?.txPowerDbm ?? 14,
    gtx: num(options, "gtx") ?? preset?.txAntennaGainDbi ?? 0,
    grx: num(options, "grx") ?? preset?.rxAntennaGainDbi ?? 0,
    ltx: num(options, "ltx") ?? preset?.txLossDb ?? 0,
    lrx: num(options, "lrx") ?? preset?.rxLossDb ?? 0,
  };
}

function runBudget(options: Options): void {
  const p = applyPreset(options);
  const result = computeLinkBudget({
    txPowerDbm: p.tx,
    frequencyMhz: requiredNum(options, "freq"),
    distanceKm: requiredNum(options, "distance"),
    sf: requiredNum(options, "sf") as SpreadingFactor,
    bandwidthKhz: requiredNum(options, "bw") as BandwidthKhz,
    txAntennaGainDbi: p.gtx,
    rxAntennaGainDbi: p.grx,
    txLossDb: p.ltx,
    rxLossDb: p.lrx,
    chip: p.chip,
    model: (str(options, "model") as PropagationModel | undefined) ??
      "log-distance",
    environment: (str(options, "env") as Environment | undefined) ??
      "suburban",
    requiredMarginDb: num(options, "margin"),
  });
  process.stdout.write(
    options["json"] === true
      ? toJson(result)
      : `${formatBudgetSummary(result)}\n`,
  );
}

function runRange(options: Options): void {
  const p = applyPreset(options);
  const freq = requiredNum(options, "freq");
  const bw = requiredNum(options, "bw") as BandwidthKhz;
  const model = (str(options, "model") as PropagationModel | undefined) ??
    "log-distance";
  const env = (str(options, "env") as Environment | undefined) ?? "suburban";
  const rows = estimateRange({
    txPowerDbm: p.tx,
    frequencyMhz: freq,
    bandwidthKhz: bw,
    txAntennaGainDbi: p.gtx,
    rxAntennaGainDbi: p.grx,
    txLossDb: p.ltx,
    rxLossDb: p.lrx,
    chip: p.chip,
    requiredMarginDb: num(options, "margin"),
    model,
    environment: env,
  });
  const header =
    `Maximum range — ${freq} MHz, ${bw} kHz, ${p.chip.toUpperCase()}, ` +
    `TX ${p.tx} dBm, ${model}/${env}, required margin ${num(options, "margin") ?? 10} dB`;
  process.stdout.write(
    options["json"] === true
      ? toJson({ frequencyMhz: freq, bandwidthKhz: bw, model, environment: env, rows })
      : `${formatRangeTable(rows, header)}\n`,
  );
}

function runAirtime(options: Options): void {
  const region = (str(options, "region") as Region | undefined) ?? "EU868";
  if (!["EU868", "US915", "AS923", "AU915"].includes(region)) {
    throw new LoraError(
      "INVALID_VALUE",
      `--region = "${region}" is not supported (EU868, US915, AS923, AU915).`,
    );
  }
  const result = airtime(
    {
      sf: requiredNum(options, "sf") as SpreadingFactor,
      bandwidthKhz: requiredNum(options, "bw") as BandwidthKhz,
      codingRate: (num(options, "cr") ?? 1) as 1 | 2 | 3 | 4,
      preambleSymbols: num(options, "preamble"),
      crc: str(options, "crc") === "off" ? false : undefined,
      explicitHeader:
        str(options, "header") === "implicit" ? false : undefined,
    },
    requiredNum(options, "payload"),
    region,
  );
  const dutyFraction = num(options, "duty") ?? EU868_DUTY_CYCLE;
  const duty = dutyCycle(result.totalMs, dutyFraction, region);
  process.stdout.write(
    options["json"] === true
      ? toJson({ ...result, dutyCycle: duty })
      : `${formatAirtime(result, duty)}\n`,
  );
}

function runCompare(options: Options): void {
  const file = str(options, "file");
  if (file === undefined) {
    throw new LoraError("INVALID_VALUE", "compare needs --file <path>.");
  }
  const outcomes = runBatch(parseBatch(readFileSync(file, "utf8")));
  process.stdout.write(
    options["json"] === true
      ? toJson(outcomes)
      : `${formatCompareTable(outcomes)}\n`,
  );
  if (outcomes.some((o) => !o.ok)) process.exitCode = 1;
}

function runBatchCommand(options: Options): void {
  const input = str(options, "input");
  const output = str(options, "output");
  if (input === undefined || output === undefined) {
    throw new LoraError(
      "INVALID_VALUE",
      "batch needs --input <path> and --output <path>.",
    );
  }
  const outcomes = runBatch(parseBatch(readFileSync(input, "utf8")));
  writeFileSync(output, toJson(outcomes));
  const failed = outcomes.filter((o) => !o.ok).length;
  process.stdout.write(
    `Wrote ${outcomes.length} result(s) to ${output} (${outcomes.length - failed} ok, ${failed} failed).\n`,
  );
  if (failed > 0) process.exitCode = 1;
}

function main(argv: string[]): void {
  try {
    const { command, options } = parseArgs(argv);
    switch (command) {
      case "budget":
        runBudget(options);
        break;
      case "range":
        runRange(options);
        break;
      case "airtime":
        runAirtime(options);
        break;
      case "compare":
        runCompare(options);
        break;
      case "batch":
        runBatchCommand(options);
        break;
      case "presets":
        process.stdout.write(`${formatPresets(listPresets())}\n`);
        break;
      case "sensitivity": {
        const chip = (str(options, "chip") as ChipId | undefined) ?? "sx1276";
        if (chip !== "sx1276" && chip !== "sx1262") {
          throw new LoraError(
            "INVALID_VALUE",
            `--chip = "${chip}" is not supported (sx1276, sx1262).`,
          );
        }
        process.stdout.write(
          `${formatSensitivityTable(chip, sensitivityTable(chip))}\n`,
        );
        break;
      }
      default:
        throw new LoraError(
          "INVALID_VALUE",
          `Unknown command "${command}". Run with --help for usage.`,
        );
    }
  } catch (error) {
    if (error instanceof LoraError) {
      process.stderr.write(`Error [${error.code}]: ${error.message}\n`);
    } else {
      process.stderr.write(`Error: ${(error as Error).message}\n`);
    }
    process.exitCode = 1;
  }
}

main(process.argv.slice(2));
