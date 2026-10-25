import { describe, expect, it } from 'vitest';
import { integerScale } from './panels/screen';
import { ANIMATED_CAPACITY, MAX_SPEED_CAPACITY, capacityFor, windowFor } from './panels/timebar';

describe('run-time bar capacity', () => {
  it('is 20 instructions when the animation sets the pace, 5 seconds of work at a steady speed, and fixed at top speed', () => {
    expect(capacityFor(true, 2)).toBe(ANIMATED_CAPACITY);
    expect(capacityFor(false, 1000)).toBe(5000);
    expect(capacityFor(false, 2)).toBe(10);
    expect(capacityFor(false, 100_000)).toBe(500_000);
    expect(capacityFor(false, Infinity)).toBe(MAX_SPEED_CAPACITY);
  });
});

describe('run-time bar window', () => {
  it('fills from the left until it is full, then slides so its right end is the latest t', () => {
    expect(windowFor(0, 5000)).toEqual({ start: 0, end: 5000 });
    expect(windowFor(3000, 5000)).toEqual({ start: 0, end: 5000 });
    expect(windowFor(5000, 5000)).toEqual({ start: 0, end: 5000 });
    expect(windowFor(7000, 5000)).toEqual({ start: 2000, end: 7000 });
    expect(windowFor(1_000_000, 5000)).toEqual({ start: 995_000, end: 1_000_000 });
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
