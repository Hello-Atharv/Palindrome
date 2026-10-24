import { describe, expect, it } from 'vitest';
import { integerScale } from './panels/screen';
import { niceCeil, tickStep } from './panels/timeline';

describe('timeline scale', () => {
  it('rounds the domain up to 1, 2 or 5 times a power of ten', () => {
    expect([niceCeil(1), niceCeil(64), niceCeil(70), niceCeil(101), niceCeil(480), niceCeil(5001)]).toEqual([1, 100, 100, 200, 500, 10000]);
  });

  it('picks the smallest 1-2-5 tick step that keeps ticks far enough apart', () => {
    expect(tickStep(100, 1000, 48)).toBe(5); // 10 px per step: 5 steps = 50 px
    expect(tickStep(10000, 1200, 48)).toBe(500); // 0.12 px per step
    expect(tickStep(64, 64, 48)).toBe(50);
  });
});

describe('screen scale', () => {
  it('uses the largest whole number that fits both ways, at least 1', () => {
    expect(integerScale(674, 270)).toBe(8);
    expect(integerScale(448, 1000)).toBe(7);
    expect(integerScale(100, 100)).toBe(1);
    expect(integerScale(10, 10)).toBe(1);
  });
});
