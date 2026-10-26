/**
 * Money handling. The API speaks decimal amounts with at most two decimal places
 * (e.g. 19.99); the database stores integer minor units (e.g. 1999), so balance
 * arithmetic is exact integer arithmetic.
 */

/** Largest amount accepted for a single transaction or transfer. */
export const MAX_AMOUNT = 1_000_000_000;

/**
 * Largest balance an account may hold: 9,999,999,999,999.99. A decimal with at most
 * 15 significant digits survives the round trip through a JavaScript number exactly,
 * so every balance stays exact in storage and in JSON responses.
 */
export const MAX_BALANCE_MINOR_UNITS = 999_999_999_999_999;
export const MAX_BALANCE = MAX_BALANCE_MINOR_UNITS / 100;

/** 19.99 → 1999. Only call with amounts that passed `hasAtMostTwoDecimals`. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

/** 1999 → 19.99 */
export function fromMinorUnits(minorUnits: number): number {
  return minorUnits / 100;
}

/**
 * Checks the number's shortest decimal representation rather than using a float
 * tolerance, which misjudges large amounts such as 999999999.99.
 */
export function hasAtMostTwoDecimals(amount: number): boolean {
  return /^-?\d+(\.\d{1,2})?$/.test(String(amount));
}
