import { describe, expect, it } from 'vitest';
import {
  makeTarotPositions,
  getTarotPresetsForCount,
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


describe('numbered tarot spread templates', () => {
  it('provides an authored, meaningful template at every size from one to twelve', () => {
    for (let count = 1; count <= 12; count += 1) {
      const id = `template-${count}` as Parameters<typeof makeTarotPositions>[0];
      const choices = getTarotPresetsForCount(count);
      const authored = choices.find((choice) => choice.id === id);
      expect(authored, `missing template for ${count} cards`).toBeDefined();
      expect(authored?.label).toBeTruthy();
      expect(choices.at(-1)?.id).toBe('custom');

      const positions = makeTarotPositions(id);
      expect(positions).toHaveLength(count);
      expect(positions.map((position) => position.number))
        .toEqual(Array.from({ length: count }, (_, i) => i + 1));
      expect(new Set(positions.map((position) => position.label)).size).toBe(count);

      for (const position of positions) {
        expect(position.label.length).toBeGreaterThan(0);
        expect(position.prompt.length).toBeGreaterThan(0);
        expect(position.x).toBeGreaterThan(0.1);
        expect(position.x).toBeLessThan(0.9);
        expect(position.y).toBeGreaterThan(0.1);
        expect(position.y).toBeLessThan(0.9);
      }
    }
  });

  it('keeps original alternate arrangements and custom blank grids', () => {
    expect(getTarotPresetsForCount(3).map((preset) => preset.id))
      .toEqual(['template-3', 'three-card', 'custom']);
    expect(getTarotPresetsForCount(6).map((preset) => preset.id))
      .toEqual(['template-6', 'circle', 'custom']);
    expect(getTarotPresetsForCount(10).map((preset) => preset.id))
      .toEqual(['template-10', 'celtic-cross', 'custom']);
    expect(makeTarotPositions('custom', 12)).toHaveLength(12);
    expect(makeTarotPositions('template-12')[0].label).toBe('January');
    expect(makeTarotPositions('template-12')[11].label).toBe('December');
  });

  it('keeps the same template data for repeated insertions', () => {
    const first = makeTarotPositions('template-8');
    const edited = updateTarotPosition(first, 2, 'label', 'My new label');
    expect(first[1].label).not.toBe(edited[1].label);
    expect(makeTarotPositions('template-8')).toEqual(first);
  });
});
