# lora-link-budget — research notes
#
# Every number the code depends on is traced to a real source below.
# Where a source only publishes part of a table, the gap is filled by an
# explicitly labelled interpolation — never by a silent invention.

## 1. LoRa modulation basics

LoRa is a chirp spread-spectrum modulation by Semtech. One symbol carries
SF bits and lasts Tsym = 2^SF / BW seconds; raising the spreading factor
(SF) doubles the symbol time, which buys ~2.5-3 dB of sensitivity per
step at the cost of airtime and data rate. The receiver can decode below
the noise floor (negative SNR), which is what makes the long range
possible.

Sources:
- Semtech, "SX1276/77/78/79 — 137 MHz to 1020 MHz Low Power Long Range
  Transceiver" datasheet, Rev. 5, August 2016, §4.1.1 "Link Design Using
  the LoRa Modem".
  https://robu-prod-media.s3.ap-south-1.amazonaws.com/products/attachments/SksizCMgjIGraI1sLAtVglxiohRdQRHGIdZKMrF0.pdf
  (mirror: https://github.com/kpierzynski/AVR_LoRaWAN/raw/refs/heads/master/doc/sx1276-1278113.pdf)
- Semtech, AN1200.22 "LoRa Modem Designer's Guide" (formulas for
  time-on-air, sensitivity limits and link design).

## 2. Receiver sensitivity (the tables in src/sensitivity.ts)

### SX1276 — transcribed from datasheet Rev. 5, §2.5.5, Band 1 ("HF")

Conditions: highest LNA gain, LnaBoost, split Rx/Tx path, 25 °C, 3.3 V.
Values are the "Typ" column, in dBm.

| SF  | 125 kHz | 250 kHz | 500 kHz |
|-----|---------|---------|---------|
| 7   | -123    | -120    | -116    |
| 8   | -126    | -123    | -119    |
| 9   | -129    | -125    | -122    |
| 10  | -132    | -128    | -125    |
| 11  | -133    | -130    | -128    |
| 12  | -136    | -133    | -130    |

Trap to avoid: the often-quoted "-137 dBm @ SF12 / 125 kHz" is the
Band 3 ("LF", 433 MHz) row of the same table (RFS_L125_LF). The HF row
used for 868/915 MHz is -136 dBm. The headline "-148 dBm" on the
datasheet cover is the SF12 figure at 7.8 kHz bandwidth (LF band), not
at 125 kHz — comparing it with a 125 kHz figure is a category error.

### SX1262 — endpoints from the datasheet, intermediates interpolated

The SX1262 datasheet's LoRa receiver table (Rx boosted gain) publishes
only the SF7 and SF12 endpoints per bandwidth:

| BW      | SF7  | SF12 |
|---------|------|------|
| 10.4 kHz| -134 | -148 |
| 125 kHz | -124 | -137 |
| 250 kHz | -121 | -134 |
| 500 kHz | -117 | -129 |

Source: Semtech SX1262 datasheet, "LoRa receiver characteristics"
(reproduced in the RF Solutions LAMBDA62 module datasheet, p. 7:
https://manuals.plus/m/8875084ff739b512f8a37d299dd159117328838935f8b9f490f47f36f324d8c6).

SF8-SF11 for the SX1262 are linearly interpolated in dB between the
endpoints (e.g. SF9/125 kHz = -129.2 dBm) and are flagged
`interpolated: true` by the code and with a `*` in CLI tables. The
progression is near-linear in the SX1276 table (3 dB per SF step, with
a 1-2 dB step at SF11), so the interpolation error is expected to stay
under ~1 dB — but it is an estimate, not a datasheet value. If you
need datasheet-grade SX1262 numbers for SF8-SF11, measure the chip or
ask Semtech for the full table.

### Minimum SNR per SF (AN1200.22)

| SF | 7 | 8 | 9 | 10 | 11 | 12 |
|----|---|---|---|----|----|----|
| min SNR (dB) | -7.5 | -10 | -12.5 | -15 | -17.5 | -20 |

### Maximum TX power

- SX1276: +20 dBm via PA_BOOST, +14 dBm via the high-efficiency RFO
  outputs (datasheet §2.5.4).
- SX1262: +22 dBm (datasheet ceiling; needs a DCDC supply and good
  matching — on an LDO expect ~1 dB less).

## 3. Time on air (src/airtime.ts)

Semtech formulas (AN1200.13 / AN1200.22, SX1276 datasheet §4.1.1):

    Tsym  = 2^SF / BW
    Tpre  = (Npreamble + 4.25) * Tsym
    Npay  = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*H)
              / (4 * (SF - 2*DE))) * (CR + 4), 0)
    Tpay  = Npay * Tsym
    Tpkt  = Tpre + Tpay

PL = payload bytes; CRC = 1 when the payload CRC is on; H = 1 for
implicit header, 0 for explicit header; DE = 1 when low data rate
optimisation is on (Semtech: enable it when Tsym > 16 ms); CR = 1..4
for coding rate 4/5..4/8.

Verified against published worked examples:
- SF7, 125 kHz, 20 B, CR 4/5, CRC on, explicit header, preamble 8:
  43 payload symbols, 44.032 ms + 12.544 ms preamble = **56.576 ms**.
- SF12, 125 kHz, 64 B, CR 4/5: 73 payload symbols, total
  **2793.472 ms** (published worked example, cross-checked against
  independent calculators).

Cross-check calculators (formula reproduced, results matched):
- https://tools.tnaado.ca/network/lora-airtime-calculator/
- https://www.nrtechstudio.com/tools/lora-airtime-calculator/
- https://episensor.com/knowledge-base/tools/lora-airtime
- Discussion of the formula's terms (incl. the 8 mandatory symbols):
  https://www.thethingsnetwork.org/forum/t/spreadsheet-for-lora-airtime-calculation/1190?page=2

Data rate: Rb = SF * (BW / 2^SF) * (4 / (4 + CR)).
Check: SF7, 125 kHz, CR 4/5 -> 5468.75 bit/s; SF12 -> 292.97 bit/s.

## 4. Propagation models (src/pathloss.ts)

### Free-space path loss (Friis)

    FSPL(dB) = 20*log10(d_km) + 20*log10(f_MHz) + 32.44

Check: 868 MHz, 1 km -> 91.21 dB; 915 MHz, 10 km -> 111.67 dB.
Valid only with a clear first Fresnel zone; real links are always
worse, which is why the default model is log-distance, not free space.

### Log-distance

    PL(d) = PL(d0) + 10*n*log10(d/d0),  d0 = 1 m, PL(d0) from Friis.

Exponents are planning defaults from Rappaport, "Wireless
Communications: Principles and Practice", Table 3.2 (free space 2;
urban cellular radio 2.7-3.5; shadowed urban 3-5; in-building LOS
1.6-1.8, obstructed 4-6), rounded to one value per environment:

| environment | n   |
|-------------|-----|
| free-space  | 2.0 |
| rural       | 2.5 |
| suburban    | 2.9 |
| urban       | 3.4 |
| dense-urban | 4.0 |

These are literature-typical values, not measurements of your site.
Measure (or sweep) n if the link matters.

### Okumura-Hata

Hata, "Empirical Formula for Propagation Loss in Land Mobile Radio
Services", IEEE Trans. Veh. Technol., vol. VT-29, no. 3, 1980
(based on Okumura et al., 1968):

    L_urban = 69.55 + 26.16*log10(f) - 13.82*log10(hb) - a(hm)
              + (44.9 - 6.55*log10(hb)) * log10(d)
    a(hm)   = (1.1*log10(f) - 0.7)*hm - (1.56*log10(f) - 0.8)
              (small/medium city)
    L_sub   = L_urban - 2*[log10(f/28)]^2 - 5.4
    L_rur   = L_urban - 4.78*(log10 f)^2 + 18.33*log10(f) - 40.94

f in MHz, hb/hm in m, d in km. Validity: f 150-1500 MHz, hb 30-200 m,
hm 1-10 m, d 1-20 km — the code throws outside this box.
Check: 868 MHz, d = 2 km, hb = 30 m, hm = 1.5 m, urban -> 136.60 dB.

## 5. Link budget (src/linkBudget.ts)

    EIRP        = Ptx + Gtx - Ltx
    Prx         = EIRP - Lpath + Grx - Lrx - Lmisc
    Link margin = Prx - Sensitivity(SF, BW, chip)

Verdict PASS means margin >= required fade margin (default 10 dB, a
common planning allowance for fading and implementation loss). It is a
planning statement, not a guarantee: antenna placement, interference,
multipath and the exact receiver implementation all move the real
number by several dB.

## 6. Regulation (planning aid, not legal advice)

- EU868: ETSI EN 300 220, 1% duty cycle in most 863-870 MHz sub-bands
  (some sub-bands allow 10%). The tool defaults to 1% and lets the
  user override it.
- US915: FCC Part 15.247 — no duty cycle, but a 400 ms dwell-time
  limit per hop. The tool flags packets that exceed it.
- LoRaWAN maximum MAC payloads (EU868, LoRa Alliance Regional
  Parameters RP002): DR5/DR4 (SF7/SF8) 222 B, DR3 (SF9) 115 B,
  DR2/DR1/DR0 (SF10/SF11/SF12) 51 B. Raw LoRa PHY frames cap at
  255 bytes (SX1276 packet engine).

## 7. References

1. Semtech. SX1276/77/78/79 datasheet, Rev. 5, August 2016.
   https://robu-prod-media.s3.ap-south-1.amazonaws.com/products/attachments/SksizCMgjIGraI1sLAtVglxiohRdQRHGIdZKMrF0.pdf
2. Semtech. SX1262 datasheet (LoRa receiver characteristics, Rx boosted
   gain); endpoints reproduced in RF Solutions, LAMBDA62 datasheet, p. 7.
   https://manuals.plus/m/8875084ff739b512f8a37d299dd159117328838935f8b9f490f47f36f324d8c6
3. Semtech. AN1200.13 / AN1200.22, "LoRa Modem Designer's Guide"
   (time-on-air formulas, SNR limits, link design).
4. LoRa Alliance. RP002 Regional Parameters (EU868 data-rate table,
   maximum MAC payloads).
5. ETSI EN 300 220, Short Range Devices operating in 863-870 MHz
   (duty-cycle limits).
6. FCC Part 15.247 (US915 dwell-time limit, 400 ms).
7. Hata, M. "Empirical Formula for Propagation Loss in Land Mobile
   Radio Services", IEEE Trans. Veh. Technol., VT-29(3), 1980.
8. Okumura, Y. et al. "Field Strength and Its Variability in VHF and
   UHF Land-Mobile Radio Service", Rev. Elec. Commun. Lab., 1968.
9. Rappaport, T. S. "Wireless Communications: Principles and Practice",
   2nd ed., Prentice Hall, 2002, ch. 3, Table 3.2 (path-loss exponents).
10. Independent airtime cross-checks:
    https://tools.tnaado.ca/network/lora-airtime-calculator/ ,
    https://www.nrtechstudio.com/tools/lora-airtime-calculator/ ,
    https://episensor.com/knowledge-base/tools/lora-airtime
