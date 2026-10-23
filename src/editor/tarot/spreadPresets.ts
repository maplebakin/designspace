/**
 * Editable tarot layouts in normalized document coordinates.
 * Positions and interpretations are authored data, not baked into an image.
 */
import { NUMBERED_TAROT_TEMPLATES, type NumberedTarotPresetId } from './spreadTemplates';

export type TarotPresetId = NumberedTarotPresetId | 'three-card' | 'four-card' | 'five-card' | 'celtic-cross' | 'circle' | 'custom';

export interface TarotPosition {
  number: number;
  label: string;
  prompt: string;
  x: number;
  y: number;
  angle: number;
}

type PositionSeed = Omit<TarotPosition, 'number'>;

export const TAROT_PRESETS: { id: TarotPresetId; label: string; description: string; cardCount: number | null }[] = [
  ...NUMBERED_TAROT_TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    cardCount: template.positions.length,
  })),
  { id: 'three-card', label: 'Past / Present / Possibility', description: 'A classic three-card line', cardCount: 3 },
  { id: 'four-card', label: 'Four-card cross', description: 'A centered, four-direction reflection', cardCount: 4 },
  { id: 'five-card', label: 'Five-card arc', description: 'An unfolding story across five cards', cardCount: 5 },
  { id: 'celtic-cross', label: 'Celtic Cross', description: 'Traditional ten-position arrangement', cardCount: 10 },
  { id: 'circle', label: 'Circle', description: 'Six positions around a central question', cardCount: 6 },
  { id: 'custom', label: 'Blank grid', description: 'Empty positions to rename and rearrange freely', cardCount: null },
];

export const getTarotPresetsForCount = (count: number) =>
  TAROT_PRESETS.filter((preset) => preset.cardCount === count || preset.id === 'custom');

const pos = (label: string, prompt: string, x: number, y: number, angle = 0): PositionSeed =>
  ({ label, prompt, x, y, angle });

const PRESETS: Record<Exclude<TarotPresetId, 'custom' | NumberedTarotPresetId>, PositionSeed[]> = {
  'three-card': [
    pos('What led here', 'What has shaped the present situation?', 0.26, 0.48),
    pos('What is here', 'What deserves attention right now?', 0.50, 0.48),
    pos('What may grow', 'What possibility can I explore next?', 0.74, 0.48),
  ],
  'four-card': [
    pos('The heart', 'What is at the center of this?', 0.50, 0.31),
    pos('What grounds me', 'What supports me?', 0.27, 0.51),
    pos('What challenges me', 'What tension needs attention?', 0.50, 0.68),
    pos('What grows next', 'What next step is available?', 0.73, 0.51),
  ],
  'five-card': [
    pos('The beginning', 'Where did this begin?', 0.18, 0.57, -12),
    pos('The influence', 'What has shaped it?', 0.34, 0.40, -6),
    pos('The center', 'What is most important now?', 0.50, 0.32),
    pos('The shift', 'What is changing?', 0.66, 0.40, 6),
    pos('The opening', 'What could come next?', 0.82, 0.57, 12),
  ],
  'celtic-cross': [
    pos('Present', 'What is happening now?', 0.33, 0.45),
    pos('Crossing', 'What challenge or influence crosses this?', 0.33, 0.45, 90),
    pos('Foundation', 'What is beneath the situation?', 0.33, 0.68),
    pos('Recent past', 'What is moving into the past?', 0.13, 0.45),
    pos('Conscious focus', 'What is on my mind?', 0.33, 0.22),
    pos('Near future', 'What is approaching?', 0.53, 0.45),
    pos('Self', 'How am I showing up?', 0.79, 0.80),
    pos('Environment', 'What surrounds me?', 0.79, 0.60),
    pos('Hopes and fears', 'What expectations influence me?', 0.79, 0.40),
    pos('Potential', 'What is a possible direction?', 0.79, 0.20),
  ],
  circle: Array.from({ length: 6 }, (_, i) => {
    const angle = (-Math.PI / 2) + i * (2 * Math.PI / 6);
    return pos(
      ['Beginning', 'Support', 'Challenge', 'Insight', 'Choice', 'Integration'][i],
      '',
      0.5 + Math.cos(angle) * 0.29,
      0.49 + Math.sin(angle) * 0.28,
      0,
    );
  }),
};

export const makeTarotPositions = (presetId: TarotPresetId, customCount = 3): TarotPosition[] => {
  const count = Math.min(12, Math.max(1, Math.floor(Number.isFinite(customCount) ? customCount : 3)));
  const authoredTemplate = NUMBERED_TAROT_TEMPLATES.find((template) => template.id === presetId);
  const seeds: PositionSeed[] = authoredTemplate
    ? authoredTemplate.positions
    : presetId === 'custom'
      ? Array.from({ length: count }, (_, index) => {
        const columns = Math.min(4, count);
        const rows = Math.ceil(count / columns);
        const col = index % columns;
        const row = Math.floor(index / columns);
        return pos(
          `Position ${index + 1}`, '',
          0.5 + (col - (columns - 1) / 2) * (columns === 4 ? 0.21 : 0.24),
          0.5 + (row - (rows - 1) / 2) * 0.19,
        );
      })
      : PRESETS[presetId as keyof typeof PRESETS];

  return seeds.map((seed, index) => ({ ...seed, number: index + 1 }));
};

export const updateTarotPosition = (
  positions: TarotPosition[],
  number: number,
  field: 'label' | 'prompt',
  value: string,
): TarotPosition[] => positions.map((position) =>
  position.number === number
    ? { ...position, [field]: value }
    : position,
);
