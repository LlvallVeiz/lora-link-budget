/**
 * Unit helpers: dBm <-> mW conversions and consistent number formatting.
 *
 * All formatting is plain and locale-independent (a fixed number of
 * decimals, '.' as the separator) so CLI output and saved example output
 * are byte-identical on every machine.
 */

/** Convert power in dBm to milliwatts. */
export function dbmToMw(dbm: number): number {
  return Math.pow(10, dbm / 10);
}

/** Convert power in milliwatts to dBm. */
export function mwToDbm(mw: number): number {
  if (!(mw > 0) || !Number.isFinite(mw)) {
    throw new Error(`mwToDbm needs a positive finite power, got ${mw}.`);
  }
  return 10 * Math.log10(mw);
}

/** Format a dB value with a sign, e.g. "+3.50 dB" / "-123.00 dBm". */
export function formatDb(value: number, unit = "dB", decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)} ${unit}`;
}

/** Format a power in dBm, e.g. "-86.21 dBm". */
export function formatDbm(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)} dBm`;
}

/** Format a duration in ms; switches to seconds above 10 s. */
export function formatMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(3)} s`;
  return `${ms.toFixed(3)} ms`;
}

/** Format a distance in km; switches to metres below 1 km. */
export function formatKm(km: number | null): string {
  if (km === null) return ">100 km";
  if (km < 1) return `${(km * 1000).toFixed(0)} m`;
  return `${km.toFixed(2)} km`;
}

/** Format a bit rate, switching to kbit/s above 1000 bit/s. */
export function formatBps(bps: number): string {
  if (bps >= 1000) return `${(bps / 1000).toFixed(2)} kbit/s`;
  return `${bps.toFixed(1)} bit/s`;
}

/** Format a percentage with one decimal. */
export function formatPercent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
