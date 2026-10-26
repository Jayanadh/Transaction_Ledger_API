import { describe, expect, it } from 'vitest';
import { fromMinorUnits, hasAtMostTwoDecimals, toMinorUnits } from '../src/money.js';

describe('money', () => {
  it('converts decimal amounts to integer minor units', () => {
    expect(toMinorUnits(100)).toBe(10000);
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.29)).toBe(29);
    expect(toMinorUnits(999999999.99)).toBe(99999999999);
  });

  it('converts minor units back to decimal amounts', () => {
    expect(fromMinorUnits(10000)).toBe(100);
    expect(fromMinorUnits(1999)).toBe(19.99);
  });

  it('accepts at most two decimal places', () => {
    expect(hasAtMostTwoDecimals(10)).toBe(true);
    expect(hasAtMostTwoDecimals(10.5)).toBe(true);
    expect(hasAtMostTwoDecimals(999999999.99)).toBe(true);
    expect(hasAtMostTwoDecimals(10.123)).toBe(false);
    expect(hasAtMostTwoDecimals(1e-7)).toBe(false);
  });
});
