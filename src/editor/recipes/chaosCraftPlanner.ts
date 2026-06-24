import type { ProductRecipe } from './productRecipeTypes';

export const chaosCraftPlannerRecipe: ProductRecipe = {
  id: 'chaosCraftPlanner',
  version: '0.1.0',
  name: 'Chaos Craft Planner',
  displayName: 'Chaos Craft Planner',
  starterDescription: 'Generate a 10-page printable craft planner using your active theme.',
  starterOutputHint: 'PDF + previews + metadata + README/listing via Product Forge ZIP.',
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
      label: 'Chaos Craft Planner',
      description: 'Printable product cover with editable title and subtitle.',
    },
    {
      id: 'project-overview',
      name: 'Project Overview',
      label: 'Project Overview',
      description: 'Project identity, materials, deadline, and priority notes.',
    },
    {
      id: 'wip-tracker',
      name: 'WIP Tracker',
      label: 'WIP Tracker',
      description: 'Works-in-progress tracker for status, next step, and due date.',
    },
    {
      id: 'yarn-stash',
      name: 'Yarn Stash',
      label: 'Yarn Stash',
      description: 'Yarn inventory page for weight, colorway, yardage, and project plans.',
    },
    {
      id: 'hook-inventory',
      name: 'Hook Inventory',
      label: 'Hook Inventory',
      description: 'Hook and tool inventory checklist.',
    },
    {
      id: 'pattern-notes',
      name: 'Pattern Notes',
      label: 'Pattern Notes',
      description: 'Pattern notes, modifications, gauge, and links.',
    },
    {
      id: 'gift-planner',
      name: 'Gift Planner',
      label: 'Gift Planner',
      description: 'Gift recipient, occasion, deadline, and wrapping notes.',
    },
    {
      id: 'frog-or-finish',
      name: 'Frog / Finish Decision',
      label: 'Frog / Finish Decision',
      description: 'Decision page for finishing, pausing, or frogging a project.',
    },
    {
      id: 'brain-dump',
      name: 'Brain Dump',
      label: 'Brain Dump',
      description: 'Open notes page for ideas, yarn math, and reminders.',
    },
    {
      id: 'blank-notes',
      name: 'Blank Notes',
      label: 'Blank Notes',
      description: 'Reusable blank notes page.',
    },
  ],
  productMetadataDefaults: {
    titleTemplate: '{Theme Name} Chaos Craft Planner',
    description:
      'A printable craft project planner for tracking works in progress, materials, yarn, hooks, gifts, pattern notes, and finish-or-frog decisions.',
    tags: [
      'craft planner',
      'crochet planner',
      'printable planner',
      'project tracker',
      'yarn stash',
      'wip tracker',
      'digital download',
    ],
    category: 'crafts',
    useCases: ['crochet planning', 'knitting planning', 'craft project tracking', 'digital product'],
    includedFiles: [
      'printable PDF',
      'PNG preview images',
      'README',
      'listing copy',
      'metadata JSON',
    ],
    listingCopy: {
      shortDescription:
        'Track WIPs, stash, hooks, pattern notes, gifts, and finish-or-frog decisions in a printable craft planner.',
      longDescription:
        'This printable craft planner helps makers organize active projects, yarn stash, hook inventory, pattern changes, gifts, loose ideas, and finish-or-frog decisions in one editable multi-page product.',
      bullets: [
        'Editable multi-page printable planner',
        'Includes WIP, yarn, hook, pattern, gift, and notes pages',
        'Prepared for PDF export and PNG preview generation',
      ],
    },
  },
  exportSettingsDefaults: {
    fileSlug: 'chaos-craft-planner',
    pdfFileName: 'chaos-craft-planner.pdf',
    previewFileNames: ['chaos-craft-planner-preview-page-01.png'],
    formats: ['pdf', 'png'],
    dpi: 300,
    includeBackground: true,
  },
};
