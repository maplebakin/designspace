# Document typography architecture

## Persisted model

Document typography is model data, not persisted CSS. A schema-v2 document
stores:

- `document.language`;
- one validated definition for each ID in `DOCUMENT_STYLE_IDS`;
- an optional language override on each page;
- a bounded drop-cap settings object on each page;
- a `documentStyleId` on editable paragraphs;
- optional bounded inline `documentTextStyle` marks;
- optional caption-specific overrides on image records.

The canonical types, defaults, validators, and trusted font-family mapping live
in `src/document/typography/documentTypography.ts`.

Named style IDs are:

- `article-title`
- `body`
- `subsection-heading`
- `caption`
- `quotation`
- `author-signature`

Font families are stored as enum IDs. Colours are normalized hex values.
Numbers are bounded. No project value is evaluated as an arbitrary CSS
declaration or font stack.

## Style cascade

The durable cascade is:

1. validated document named style;
2. optional safe block override used by legacy title-size migration;
3. optional safe inline mark;
4. optional image-specific caption presentation override.

Caption alignment, italic, and spacing use the explicit `inherit` sentinel
when the named caption style should apply. This avoids duplicating the named
style into every image while retaining independent caption controls.

## Editor and export contract

`getDocumentTypographyCssVariables()` is the only adapter from persisted style
definitions to renderer CSS variables. The live page, structured text
measurer, structured renderer, committed offscreen page renderer, and export
clone consume those variables.

Tiptap extensions store semantic roles and bounded inline overrides:

- `DocumentBlockStyleExtension`
- `DocumentTextStyleExtension`

The editor schema remains paragraph based. Semantic roles deliberately do not
enable arbitrary pasted heading or style elements.

## Language and hyphenation

Page language inherits from the document unless explicitly overridden. The
effective language is placed on the live title/body, structured measurement
host, structured output, and export root.

`hyphens: auto` delegates dictionary selection to the browser using that
language. `overflow-wrap: break-word` is the deterministic fallback where a
browser lacks a suitable hyphenation dictionary. Fixtures use German metadata;
line-for-line source fidelity is not guaranteed across browser engines.

## Schema-v1 migration

Schema-v1 documents preserve their previous appearance:

- the absent legacy title size maps to 42px;
- an explicit first-page title size becomes the article-title named size;
- a different later-page title size becomes a bounded paragraph override,
  including for an empty title;
- legacy dark text, left body alignment, and caption presentation remain;
- `dropCap: true` maps to enabled default settings;
- hostile inline style attributes normalize to safe values or `null`.

The block override is content-level migration data, not a second page-level
title-style field. New documents use the historical blue title, justified
serif body, and centered italic caption defaults.

