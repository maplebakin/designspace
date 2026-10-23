import { describe, expect, it } from 'vitest';
import {
  makeTarotPositions,
  TAROT_PRESETS,
  updateTarotPosition,
} from '../src/editor/tarot/spreadPresets';

describe('tarot spread definitions', () => {
  it('offers reproducible numbered presets', () => {
    expect(TAROT_PRESETS.map((preset) => preset.id)).toContain('celtic-cross');
    expect(makeTarotPositions('three-card')).toHaveLength(3);
    const cross = makeTarotPositions('celtic-cross');
    expect(cross).toHaveLength(10);
    expect(cross.map((position) => position.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(cross[1].angle).toBe(90);
  });

  it('keeps positions within the document and accepts custom counts 1–12', () => {
    expect(makeTarotPositions('custom', 0)).toHaveLength(1);
    expect(makeTarotPositions('custom', 100)).toHaveLength(12);
    for (const preset of TAROT_PRESETS) {
      for (const position of makeTarotPositions(preset.id, 12)) {
        expect(position.x).toBeGreaterThan(0);
        expect(position.x).toBeLessThan(1);
        expect(position.y).toBeGreaterThan(0);
        expect(position.y).toBeLessThan(1);
      }
    }
  });

  it('edits one interpretation without mutating other positions', () => {
    const before = makeTarotPositions('three-card');
    const after = updateTarotPosition(before, 2, 'prompt', 'What matters now?');
    expect(after[1].prompt).toBe('What matters now?');
    expect(before[1].prompt).not.toBe('What matters now?');
    expect(after[0]).toEqual(before[0]);
  });
});
