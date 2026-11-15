# Changelog

All notable changes to `lora-link-budget` are documented here.

## [1.0.0] — 2026-11-15

- Initial release.
- Link budget (EIRP, path loss, received power, link margin, PASS/FAIL)
  with free-space, log-distance and Okumura-Hata propagation models.
- Maximum-range estimation per spreading factor (SF7–SF12).
- Time on air from the Semtech formulas (AN1200.13/AN1200.22), with
  duty-cycle and US915 dwell-time checks.
- Receiver sensitivity tables transcribed from the SX1276 datasheet
  (Rev. 5, §2.5.5, Band 1 HF) and the SX1262 datasheet endpoints
  (SF8–SF11 interpolated and flagged as estimates).
- Five device presets (SX1276 node, RFM95, SX1262 node, ESP32+LoRa,
  gateway planning proxy).
- CLI (`budget`, `range`, `airtime`, `compare`, `batch`, `presets`,
  `sensitivity`) with text and JSON output; batch mode from JSON/CSV.
- 71 tests (unit + CLI smoke), all passing on Node 24, zero runtime
  dependencies.
