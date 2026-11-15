# lora-link-budget

LoRa link budget, propagation-range and time-on-air calculator for the
SX1276 and SX1262 — as a TypeScript library and a zero-dependency CLI.

It answers the three questions every LoRa deployment starts with:

1. **Will this link close?** — EIRP, path loss, received power and link
   margin against the receiver's real datasheet sensitivity.
2. **How far will it reach?** — maximum range per spreading factor under
   free-space, log-distance or Okumura-Hata propagation.
3. **How long is it on the air?** — packet time on air from the Semtech
   formulas, with duty-cycle and dwell-time checks.

## Background

LoRa trades data rate for sensitivity: each step up in spreading factor
(SF) roughly doubles the symbol time and buys ~3 dB of sensitivity.
Whether a link works is decided by the link budget:

```
EIRP        = Ptx + Gtx - Ltx
Prx         = EIRP - Lpath + Grx - Lrx - Lmisc
Link margin = Prx - Sensitivity(SF, BW, chip)
```

The sensitivity values are transcribed from the chip datasheets
(SX1276 Rev. 5 §2.5.5; SX1262 receiver characteristics) — see
[`docs/RESEARCH.md`](docs/RESEARCH.md) for the tables, the sources and
the one trap to avoid (the often-quoted "-137 dBm @ SF12/125 kHz" is the
433 MHz row; the 868/915 MHz row is -136 dBm).

Propagation is modelled three ways:

- **Free space (Friis):** `FSPL = 20·log10(d) + 20·log10(f) + 32.44`
  (d in km, f in MHz). Check: 868 MHz, 1 km → **91.21 dB**.
- **Log-distance:** `PL(d) = PL(1 m) + 10·n·log10(d/1 m)` with
  environment exponents (free-space 2.0, rural 2.5, suburban 2.9,
  urban 3.4, dense-urban 4.0) from Rappaport Table 3.2.
- **Okumura-Hata:** the 1980 empirical model for 150–1500 MHz,
  30–200 m base-station height, 1–20 km. Check: 868 MHz, 2 km, urban
  → **136.60 dB**.

Time on air follows the Semtech formulas (AN1200.13/AN1200.22):

```
Tsym = 2^SF / BW
Tpre = (Npreamble + 4.25) · Tsym
Npay = 8 + max(ceil((8·PL - 4·SF + 28 + 16·CRC - 20·H) / (4·(SF - 2·DE))) · (CR + 4), 0)
Tpacket = Tpre + Npay · Tsym
```

## Installation

Requires Node.js ≥ 18. No runtime dependencies.

```bash
npm install
npm run build
```

## Usage

```bash
# Link budget: RFM95 node, 868 MHz, 2 km, SF12, urban
node dist/src/cli.js budget --preset rfm95 --freq 868 --distance 2 --sf 12 --bw 125 --env urban

# Maximum range per SF: SX1262 node, 915 MHz, rural
node dist/src/cli.js range --preset sx1262-node --freq 915 --bw 125 --model log-distance --env rural

# Time on air: 20-byte packet, SF7, 125 kHz, EU 1% duty cycle
node dist/src/cli.js airtime --sf 7 --bw 125 --payload 20 --duty 0.01

# Compare scenarios from a file (JSON or CSV), or run a batch to a file
node dist/src/cli.js compare --file examples/batch-scenarios.json
node dist/src/cli.js batch --input examples/batch-scenarios.csv --output results.json

# Reference tables
node dist/src/cli.js sensitivity --chip sx1276
node dist/src/cli.js presets
```

Every command accepts `--json` for machine-readable output. Run
`node dist/src/cli.js --help` for the full option list.

## Example output (real runs — see `examples/output/`)

**Link budget, RFM95, 868 MHz, 2 km, SF12/125 kHz, urban:**

```
Link budget — 868 MHz, SF12, 125 kHz, SX1276, log-distance/urban, 2 km
  EIRP            21.00 dBm
  Path loss       +143.45 dB
  Received power  -121.45 dBm
  Sensitivity     -136.00 dBm
  Link margin     +14.55 dB
  Required margin +10.00 dB
  Verdict         PASS (margin above required: +4.55 dB)
  Max path loss   +148.00 dB
  Min SNR (SF12)  -20.00 dB
  Data rate       293.0 bit/s (CR 4/5)
```

The same link at SF7 fails — sensitivity is 13 dB worse
(-123 dBm), leaving only +1.55 dB of margin against the 10 dB
requirement.

**Maximum range, SX1262 node, 915 MHz, rural, TX +22 dBm:**

```
Maximum range — 915 MHz, 125 kHz, SX1262, TX 22 dBm, log-distance/rural, required margin 10 dB
SF   Sensitivity   Max path loss  Max range
----------------------------------------------
SF7  -124.00 dBm   +139.00 dB     19.65 km
SF8  -126.60 dBm   +141.60 dB     24.96 km
SF9  -129.20 dBm   +144.20 dB     31.71 km
SF10 -131.80 dBm   +146.80 dB     40.30 km
SF11 -134.40 dBm   +149.40 dB     51.20 km
SF12 -137.00 dBm   +152.00 dB     65.05 km
```

Rural SF12 reaches **65.05 km** in this planning model (free-space-like
rural exponent 2.5, 10 dB fade margin). Real terrain, antenna height
and interference will cut this down — treat it as an upper bound, not
a promise. Urban SF12 with an SX1276 node at +14 dBm is **~1.94 km**.

**Time on air, SF7/125 kHz, 20-byte payload, CR 4/5:**

```
Time on air — SF7, 125 kHz, 20 B payload, CR 4/5, preamble 8, CRC on, explicit header, LDRO off
  Symbol duration 1.024 ms
  Preamble        12.544 ms
  Payload symbols 43
  Payload time    44.032 ms
  Total airtime   56.576 ms
  Data rate       5.47 kbit/s
  LoRaWAN max payload (SF7/125 kHz)  222 B
  Duty cycle      1.0% -> min interval 5657.600 ms, max 636.3 packets/hour
```

And the published cross-check: SF12/125 kHz, 64 B → **2793.472 ms**,
which exceeds the US915 400 ms dwell-time limit (flagged by the tool).

**Scenario comparison (`examples/batch-scenarios.json`):**

```
Scenario                    SF   Prx          Margin     Verdict  Airtime
------------------------------------------------------------------------------
urban-sf7-1km               SF7  -111.21 dBm  +11.79 dB  PASS     56.576 ms
urban-sf12-2km              SF12 -121.45 dBm  +14.55 dB  PASS     1318.912 ms
rural-sf12-5km              SF12 -99.14 dBm   +37.86 dB  PASS     1318.912 ms
gateway-sf9-3km             SF9  -100.05 dBm  +28.95 dB  PASS     185.344 ms
hata-urban-sf10-2km         SF10 -120.60 dBm  +11.40 dB  PASS     370.688 ms
```

## Project structure

```
src/
  types.ts        Shared types (SF, bandwidth, chip, inputs, results)
  errors.ts       LoraError with machine-readable codes
  units.ts        dBm/mW conversion and locale-independent formatting
  pathloss.ts     Friis FSPL, log-distance, Okumura-Hata, range solver
  sensitivity.ts  SX1276/SX1262 sensitivity tables, min SNR, data rate,
                  LoRaWAN max payload
  airtime.ts      Semtech time-on-air formulas, duty cycle, dwell time
  linkBudget.ts   Link-budget math and per-SF range estimation
  presets.ts      Device presets (SX1276 node, RFM95, SX1262, ESP32+LoRa,
                  gateway planning proxy)
  report.ts       Text tables and JSON output formatting
  batch.ts        JSON/CSV batch parsing and per-row error isolation
  cli.ts          Argument parsing and subcommands
  index.ts        Public library entry point
tests/            node:test suites (unit + CLI smoke tests)
examples/         Scenario JSON/CSV files + output from real CLI runs
docs/RESEARCH.md  Sources, transcribed tables, formulas, references
scripts/run-examples.sh  Regenerates examples/output/ from the CLI
```

## Library use

```typescript
import { computeLinkBudget, airtime, estimateRange } from "lora-link-budget";

const budget = computeLinkBudget({
  txPowerDbm: 20, frequencyMhz: 868, distanceKm: 2,
  sf: 12, bandwidthKhz: 125,
  txAntennaGainDbi: 2, rxAntennaGainDbi: 2, txLossDb: 1, rxLossDb: 1,
  chip: "sx1276", model: "log-distance", environment: "urban",
});
console.log(budget.verdict, budget.linkMarginDb); // PASS 14.55...

const toa = airtime({ sf: 7, bandwidthKhz: 125 }, 20);
console.log(toa.totalMs); // 56.576
```

## Design decisions

- **Zero runtime dependencies.** The CLI is hand-rolled argument
  parsing over the compiled library, so `npm install` only fetches the
  TypeScript compiler.
- **Datasheet values, not folklore.** Sensitivity comes from the
  datasheets, transcribed in `src/sensitivity.ts` and documented with
  provenance in `docs/RESEARCH.md`. The one place the datasheet is
  silent (SX1262 SF8–SF11) is filled by linear interpolation that is
  flagged everywhere it appears (`interpolated: true`, `*` in tables).
- **Planning numbers, labelled as such.** Path-loss exponents and
  antenna gains are literature-typical defaults, user-overridable, and
  documented as estimates — never presented as measurements.
- **Fail loudly on bad input.** Every validation failure is a
  `LoraError` naming the field, the value and the valid range; batch
  mode isolates a bad row instead of aborting the whole run, and
  `compare` exits non-zero when any row fails.
- **Hata enforces its validity box** (150–1500 MHz, hb 30–200 m,
  hm 1–10 m, d 1–20 km) instead of silently extrapolating.

## Limitations and future work

- SF6, FSK/(G)FSK and LR-FHSS are out of scope (SX127x LoRa SF7–SF12
  only). SF6 needs special handling in the airtime formula.
- No terrain data: log-distance and Hata are statistical models. For
  site-specific planning, feed a measured path-loss exponent or a
  terrain-aware model (e.g. ITM/Longley-Rice).
- No interference or multi-gateway modelling; the margin is a single
  fade allowance, not a full outage-probability calculation.
- Duty-cycle rules are planning aids (EU 1%, US 400 ms dwell). Check
  the current ETSI/FCC rules for your band and sub-band before
  deploying.
- Gateway preset sensitivity uses the SX1276 table as a proxy; real
  concentrators (SX1301/1302/1303) publish their own figures.

## Tests

```bash
npm test   # tsc build + node --test (71 tests)
```

The suite anchors every formula to a hand-computed or published
value: FSPL 868 MHz/1 km = 91.21 dB, Hata urban 2 km = 136.60 dB,
airtime SF7/20 B = 56.576 ms, airtime SF12/64 B = 2793.472 ms,
data rate SF7/125 kHz = 5468.75 bit/s, plus CLI smoke tests that spawn
the real binary and match its stdout.

## License

MIT — see [LICENSE](LICENSE).
