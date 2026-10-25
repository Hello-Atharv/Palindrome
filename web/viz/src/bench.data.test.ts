// @vitest-environment node
// The Benchmarks tab's numbers for Pong and sort are the numbers in bench/results.json, exactly.
import { describe, expect, it } from 'vitest';

import { offlineBaselines, results, sortPoints } from './panels/bench';

describe('the sort benchmark', () => {
  it('has the same four strategies as Pong: naive and tight diary, checkpoint intervals, and the reversible program', () => {
    const pts = sortPoints();
    expect(pts.map((p) => p.strategy)).toEqual(['naive', 'tight', 'checkpoint', 'checkpoint', 'checkpoint', 'reversible']);
    expect(pts.every((p) => p.seekMean !== null)).toBe(true); // every point can be drawn
    const byName = Object.fromEntries(pts.map((p) => [p.name, p]));
    expect(byName['Naive diary'].bytes).toBe(results.sort.naiveDiaryBytes);
    expect(byName['Tight diary'].bytes).toBe(results.sort.tightDiaryBytes);
    expect(byName['Reversible'].bytes).toBe(results.sort.reversibleGarbageBytes); // its 14 flag words, nothing in the machine
  });

  it('fills the checkpoint row of the live Compare table from the benchmark, not "not measured"', () => {
    const sort = offlineBaselines('sort')!;
    expect(sort.checkpoint).toEqual(['200 to 2,100 B for the whole run', '–', '1,600 bits to 16,800 bits', '102 steps', 'worst case 4 to 99 steps of replay']);
  });
});
