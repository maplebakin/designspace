import type { TarotPosition } from './spreadPresets';

/**
 * WitchClick-friendly, secular tarot spreads. Every card count has a distinct,
 * reusable starting arrangement and reflective questions. The coordinates are
 * normalized so the existing canvas renderer handles every page size.
 */
export const NUMBERED_TAROT_IDS = [
  'template-1', 'template-2', 'template-3', 'template-4',
  'template-5', 'template-6', 'template-7', 'template-8',
  'template-9', 'template-10', 'template-11', 'template-12',
] as const;

export type NumberedTarotPresetId = typeof NUMBERED_TAROT_IDS[number];

export interface NumberedTarotTemplate {
  id: NumberedTarotPresetId;
  label: string;
  description: string;
  positions: Omit<TarotPosition, 'number'>[];
}

const p = (label: string, prompt: string, x: number, y: number, angle = 0): Omit<TarotPosition, 'number'> =>
  ({ label, prompt, x, y, angle });

export const NUMBERED_TAROT_TEMPLATES: NumberedTarotTemplate[] = [
  {
    id: 'template-1',
    label: 'The Pause',
    description: 'One card for a grounded daily check-in',
    positions: [
      p('What matters now', 'What deserves my attention today?', 0.50, 0.51),
    ],
  },
  {
    id: 'template-2',
    label: 'The Conversation',
    description: 'Two viewpoints in dialogue',
    positions: [
      p('What I know', 'What do I know or notice about this?', 0.34, 0.51),
      p('What I wonder', 'What remains uncertain or worth exploring?', 0.66, 0.51),
    ],
  },
  {
    id: 'template-3',
    label: 'The Fork in the Road',
    description: 'A three-card triangle for navigating a choice',
    positions: [
      p('What calls for change', 'What is asking for my attention?', 0.50, 0.29),
      p('One direction', 'What could I gain or learn from one option?', 0.31, 0.63),
      p('Another direction', 'What could I gain or learn from another option?', 0.69, 0.63),
    ],
  },
  {
    id: 'template-4',
    label: 'The Four Corners',
    description: 'A compass for looking at a situation from four angles',
    positions: [
      p('The situation', 'What is happening in the present?', 0.50, 0.23),
      p('The support', 'What helps me navigate this?', 0.27, 0.49),
      p('The friction', 'Where am I encountering resistance?', 0.73, 0.49),
      p('A next step', 'What is one practical way forward?', 0.50, 0.75),
    ],
  },
  {
    id: 'template-5',
    label: 'The Threshold',
    description: 'A five-card arch for examining a transition',
    positions: [
      p('What I leave', 'What am I ready to set down?', 0.17, 0.62, -10),
      p('What I carry', 'What experience or strength travels with me?', 0.33, 0.38, -5),
      p('The threshold', 'What is the central challenge of this transition?', 0.50, 0.27),
      p('What I need', 'What would help me cross this threshold?', 0.67, 0.38, 5),
      p('What opens', 'What possibility might be available?', 0.83, 0.62, 10),
    ],
  },
  {
    id: 'template-6',
    label: 'The Loom',
    description: 'Two rows of three for patterns, resources and choices',
    positions: [
      p('The pattern', 'What pattern do I recognize?', 0.24, 0.33),
      p('The trigger', 'What tends to set it in motion?', 0.50, 0.33),
      p('The effect', 'How does this pattern affect me?', 0.76, 0.33),
      p('The resource', 'What resource is already available?', 0.24, 0.68),
      p('The interruption', 'What could I try differently?', 0.50, 0.68),
      p('The practice', 'What small practice could support change?', 0.76, 0.68),
    ],
  },
  {
    id: 'template-7',
    label: 'The Lantern',
    description: 'One guiding question above two rows of three',
    positions: [
      p('The guiding light', 'What principle matters most here?', 0.50, 0.20),
      p('What I see', 'What feels clear?', 0.23, 0.43),
      p('What I miss', 'What might I have overlooked?', 0.50, 0.43),
      p('What I fear', 'What concern is shaping my response?', 0.77, 0.43),
      p('What supports me', 'Who or what can support me?', 0.23, 0.72),
      p('What I can choose', 'Which part is in my control?', 0.50, 0.72),
      p('What I can release', 'What responsibility is not mine to carry?', 0.77, 0.72),
    ],
  },
  {
    id: 'template-8',
    label: 'The Mirror',
    description: 'Two columns of four: inner experience and outward action',
    positions: [
      p('Inner need', 'What need is present beneath the surface?', 0.32, 0.20),
      p('Outer reality', 'What is actually happening around me?', 0.68, 0.20),
      p('Inner story', 'What interpretation am I bringing?', 0.32, 0.40),
      p('Outer evidence', 'What observations support or challenge it?', 0.68, 0.40),
      p('Inner resource', 'What personal strength can I draw upon?', 0.32, 0.60),
      p('Outer resource', 'What help or support is available?', 0.68, 0.60),
      p('Inner intention', 'How would I like to respond?', 0.32, 0.80),
      p('Outer action', 'What concrete action aligns with that intention?', 0.68, 0.80),
    ],
  },
  {
    id: 'template-9',
    label: 'Nine Windows',
    description: 'A three-by-three perspective map',
    positions: [
      p('Context', 'What brought me here?', 0.23, 0.23),
      p('Influence', 'What is affecting this?', 0.50, 0.23),
      p('Assumption', 'What might I be taking for granted?', 0.77, 0.23),
      p('Feeling', 'What am I feeling?', 0.23, 0.49),
      p('Core question', 'What is the heart of the matter?', 0.50, 0.49),
      p('Need', 'What do I need?', 0.77, 0.49),
      p('Support', 'What might help?', 0.23, 0.75),
      p('Choice', 'Which choice is available?', 0.50, 0.75),
      p('Reflection', 'What can I take forward?', 0.77, 0.75),
    ],
  },
  {
    id: 'template-10',
    label: 'The Full Picture',
    description: 'Two rows of five for a comprehensive review',
    positions: [
      p('Background', 'What background matters?', 0.14, 0.34),
      p('Present', 'What is happening now?', 0.32, 0.34),
      p('Tension', 'Where is the pressure?', 0.50, 0.34),
      p('Pattern', 'What keeps recurring?', 0.68, 0.34),
      p('Unknown', 'What would be useful to learn?', 0.86, 0.34),
      p('Strength', 'What strength can I draw on?', 0.14, 0.69),
      p('Support', 'What support is available?', 0.32, 0.69),
      p('Boundary', 'What limit needs honoring?', 0.50, 0.69),
      p('Next action', 'What is one possible next step?', 0.68, 0.69),
      p('Integration', 'What will I carry into the future?', 0.86, 0.69),
    ],
  },
  {
    id: 'template-11',
    label: 'The Turning Point',
    description: 'An eleven-card staircase of reflection and change',
    positions: [
      p('Signal', 'What first suggested something needed to change?', 0.38, 0.20),
      p('Awareness', 'What do I recognize now?', 0.62, 0.20),
      p('History', 'What history informs this?', 0.23, 0.40),
      p('Habit', 'What habitual response is present?', 0.50, 0.40),
      p('Tension', 'Where do competing needs meet?', 0.77, 0.40),
      p('Value', 'Which value do I want to honor?', 0.23, 0.60),
      p('Capacity', 'What energy or capacity is available?', 0.50, 0.60),
      p('Support', 'What could help me?', 0.77, 0.60),
      p('Choice', 'What can I choose?', 0.23, 0.80),
      p('First step', 'What is one manageable first step?', 0.50, 0.80),
      p('Check-in', 'How will I know whether it is helping?', 0.77, 0.80),
    ],
  },
  {
    id: 'template-12',
    label: 'A Year in Reflection',
    description: 'Twelve monthly prompts, January through December',
    positions: [
      p('January', 'What theme might I explore in January?', 0.18, 0.24),
      p('February', 'What theme might I explore in February?', 0.39, 0.24),
      p('March', 'What theme might I explore in March?', 0.61, 0.24),
      p('April', 'What theme might I explore in April?', 0.82, 0.24),
      p('May', 'What theme might I explore in May?', 0.18, 0.50),
      p('June', 'What theme might I explore in June?', 0.39, 0.50),
      p('July', 'What theme might I explore in July?', 0.61, 0.50),
      p('August', 'What theme might I explore in August?', 0.82, 0.50),
      p('September', 'What theme might I explore in September?', 0.18, 0.76),
      p('October', 'What theme might I explore in October?', 0.39, 0.76),
      p('November', 'What theme might I explore in November?', 0.61, 0.76),
      p('December', 'What theme might I explore in December?', 0.82, 0.76),
    ],
  },
];

export const getNumberedTarotTemplate = (id: NumberedTarotPresetId): NumberedTarotTemplate | undefined =>
  NUMBERED_TAROT_TEMPLATES.find((template) => template.id === id);
