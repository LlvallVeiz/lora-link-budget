/**
 * Device presets: real-world radios and modules with their documented
 * transmit power and typical antenna/loss figures.
 *
 * Chip sensitivity comes from the datasheet tables in sensitivity.ts.
 * Antenna gains and cable losses are *typical planning figures* for the
 * stated hardware (a 2 dBi whip on a node, a 5 dBi collinear on a
 * gateway, ~0.5-1 dB of connector/cable loss) — measure your own
 * hardware when the link matters. The gateway preset uses the SX1276
 * sensitivity table as a planning proxy and says so: real concentrators
 * (SX1301/1302/1303) publish their own sensitivity figures.
 */
import { valueError } from "./errors.js";
import type { DevicePreset } from "./types.js";

export const PRESETS: Readonly<Record<string, DevicePreset>> = {
  "sx1276-node": {
    id: "sx1276-node",
    name: "SX1276 node (generic)",
    description:
      "Bare SX1276 transceiver on a sensor node, 868/915 MHz, 2 dBi whip antenna.",
    chip: "sx1276",
    txPowerDbm: 14,
    txAntennaGainDbi: 2,
    txLossDb: 0.5,
    rxAntennaGainDbi: 2,
    rxLossDb: 0.5,
    notes:
      "TX +14 dBm is the high-efficiency RFO output; +20 dBm needs PA_BOOST.",
  },
  rfm95: {
    id: "rfm95",
    name: "HopeRF RFM95W (SX1276)",
    description:
      "RFM95/95W module built on the SX1276, PA_BOOST output, common in Arduino/ESP32 LoRa nodes.",
    chip: "sx1276",
    txPowerDbm: 20,
    txAntennaGainDbi: 2,
    txLossDb: 1,
    rxAntennaGainDbi: 2,
    rxLossDb: 1,
    notes:
      "Module max TX is +20 dBm (PA_BOOST); 1 dB allows for the u.FL pigtail and matching.",
  },
  "sx1262-node": {
    id: "sx1262-node",
    name: "SX1262 node (generic)",
    description:
      "Second-generation SX1262 node, 868/915 MHz, 2 dBi whip antenna.",
    chip: "sx1262",
    txPowerDbm: 22,
    txAntennaGainDbi: 2,
    txLossDb: 0.5,
    rxAntennaGainDbi: 2,
    rxLossDb: 0.5,
    notes:
      "TX +22 dBm is the datasheet ceiling (DCDC supply, good matching); on an LDO expect ~1 dB less.",
  },
  "esp32-lora": {
    id: "esp32-lora",
    name: "ESP32 + LoRa (Heltec/TTGO class)",
    description:
      "Heltec WiFi LoRa 32 / TTGO LoRa32 style board: ESP32 + SX1276, small helical/whip antenna.",
    chip: "sx1276",
    txPowerDbm: 14,
    txAntennaGainDbi: 2,
    txLossDb: 1,
    rxAntennaGainDbi: 2,
    rxLossDb: 1,
    notes:
      "Small on-board antennas are often closer to 0-2 dBi in practice; 2 dBi is optimistic for a helical.",
  },
  gateway: {
    id: "gateway",
    name: "LoRaWAN gateway (planning proxy)",
    description:
      "Outdoor gateway with a 5 dBi collinear antenna and short feeder; TX at the EU 868 MHz sub-band limit.",
    chip: "sx1276",
    txPowerDbm: 27,
    txAntennaGainDbi: 5,
    txLossDb: 1,
    rxAntennaGainDbi: 5,
    rxLossDb: 1,
    notes:
      "PLANNING PROXY: sensitivity uses the SX1276 table; real concentrators (SX1301/1302/1303) differ. TX +27 dBm is the EU 869.4-869.65 MHz sub-band EIRP-adjacent limit — check local rules.",
  },
};

/** Look up a preset by id; throws a clear error for unknown ids. */
export function getPreset(id: string): DevicePreset {
  const preset = PRESETS[id];
  if (preset === undefined) {
    throw valueError("preset", id, Object.keys(PRESETS));
  }
  return preset;
}

/** All presets, in definition order. */
export function listPresets(): DevicePreset[] {
  return Object.values(PRESETS);
}
