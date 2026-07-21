import type { ProductRecipe } from './productRecipeTypes';

export const crochetPatternDecoderRecipe: ProductRecipe = {
  id: 'crochetPatternDecoder',
  version: '0.1.0',
  name: 'Crochet Pattern Decoder Kit',
  displayName: 'Crochet Pattern Decoder Kit',
  starterDescription:
    'Break down crochet patterns into abbreviations, stitch notes, gauge checks, row tracking, and modification notes.',
  starterOutputHint: 'Printable PDF + page previews + portable product metadata.',
  defaultPageSize: {
    presetId: 'us-letter',
    width: 2550,
    height: 3300,
    unitMode: 'in',
    dpi: 300,
  },
  pages: [
    {
      id: 'cover',
      name: 'Cover',
      label: 'Crochet Pattern Decoder Kit',
      description: 'Printable product cover with editable title, subtitle, and theme accent.',
    },
    {
      id: 'pattern-snapshot',
      name: 'Pattern Snapshot',
      label: 'Pattern Snapshot',
      description: 'Pattern source, yarn, hook, skill level, finished size, and notes.',
    },
    {
      id: 'abbreviation-decoder',
      name: 'Abbreviation Decoder',
      label: 'Abbreviation Decoder',
      description: 'Abbreviation table for pattern terms, meanings, examples, and notes.',
    },
    {
      id: 'stitch-symbol-key',
      name: 'Stitch & Symbol Key',
      label: 'Stitch & Symbol Key',
      description: 'Stitch and symbol reference table for charted or written instructions.',
    },
    {
      id: 'gauge-swatch-notes',
      name: 'Gauge + Swatch Notes',
      label: 'Gauge + Swatch Notes',
      description: 'Gauge target, actual gauge, yarn, hook size, and adjustment notes.',
    },
    {
      id: 'row-round-tracker',
      name: 'Row / Round Tracker',
      label: 'Row / Round Tracker',
      description: 'Row and round tracker for instructions, stitch counts, completion, and notes.',
    },
    {
      id: 'section-breakdown',
      name: 'Section Breakdown',
      label: 'Section Breakdown',
      description: 'Pattern section planning for goals, tricky parts, rows, rounds, and status.',
    },
    {
      id: 'modification-notes',
      name: 'Modification Notes',
      label: 'Modification Notes',
      description: 'Modification log for original instructions, changes, reasons, and impact.',
    },
    {
      id: 'trouble-spots',
      name: 'Trouble Spots',
      label: 'Trouble Spots',
      description: 'Troubleshooting page for issues, locations, possible fixes, and resolution notes.',
    },
    {
      id: 'project-finish-notes',
      name: 'Project Finish Notes',
      label: 'Project Finish Notes',
      description: 'Finishing checklist and final project measurements, blocking, and lessons learned.',
    },
  ],
  productMetadataDefaults: {
    titleTemplate: '{Theme Name} Crochet Pattern Decoder Kit',
    description:
      'A printable crochet pattern helper for decoding abbreviations, tracking rows and rounds, testing gauge, noting modifications, and untangling tricky instructions.',
    tags: [
      'crochet planner',
      'crochet pattern worksheet',
      'crochet tracker',
      'row tracker',
      'gauge notes',
      'crochet printable',
      'digital download',
    ],
    category: 'crafts',
    useCases: [
      'crochet pattern decoding',
      'row tracking',
      'gauge planning',
      'pattern modification notes',
      'digital product',
    ],
    includedFiles: [
      'printable PDF',
      'PNG preview images',
      'metadata JSON',
      'manifest JSON',
      'README',
      'listing copy',
    ],
    listingCopy: {
      shortDescription:
        'Decode crochet patterns, track rows and rounds, test gauge, and capture modifications in a printable worksheet kit.',
      longDescription:
        'This printable crochet pattern decoder kit helps makers translate abbreviations, track row and round progress, record stitch and symbol notes, test gauge, document modifications, and work through confusing instructions.',
      bullets: [
        'Editable 10-page printable crochet worksheet kit',
        'Includes abbreviation, stitch, gauge, tracker, modification, and troubleshooting pages',
        'Prepared for PDF export, PNG previews, metadata, README, and listing copy',
      ],
    },
  },
  exportSettingsDefaults: {
    fileSlug: 'crochet-pattern-decoder-kit',
    pdfFileName: 'crochet-pattern-decoder-kit.pdf',
    previewFileNames: ['crochet-pattern-decoder-kit-preview-page-01.png'],
    formats: ['pdf', 'png'],
    dpi: 300,
    includeBackground: true,
  },
};
