import type { JSONContent } from '@tiptap/core';
import {
  normalizeDesignSpaceProjectPayload,
  type DocumentProjectPayload,
} from '../../editor/project/projectSchema';
import {
  DEFAULT_DOCUMENT_DROP_CAP,
  DEFAULT_DOCUMENT_STYLES,
} from '../typography/documentTypography';
import {
  fingerprintDocumentAssetSource,
} from '../model/documentAssets';
import type {
  DocumentContentJson,
  DocumentImageGroup,
  DocumentPage,
} from '../types/documentProject';

/**
 * Deterministic one-pixel PNG retained for pages whose source photographs are
 * not part of the supplied historical reference set.
 */
const FIXTURE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAABmJLR0QA/wD/AP+gvaeTAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

// These are the two supplied page 50 source photographs. They live under
// public/ so the normal browser and packaged Tauri asset protocols can load
// them, while the export service embeds them into the raster output.
const PAGE_50_LEFT_ASSET = '/historical-book/page50-left.jpg';
const PAGE_50_RIGHT_ASSET = '/historical-book/page50-right.jpg';

export const HISTORICAL_BOOK_FIXTURE_ASSET_IDS = {
  page49: 'historical-photo-49',
  page50Left: 'historical-photo-50-left',
  page50Right: 'historical-photo-50-right',
  page51Top: 'historical-photo-51-top',
  page51Bottom: 'historical-photo-51-bottom',
} as const;

const paragraph = (
  text: string,
  documentStyleId: 'body' | 'article-title' | 'subsection-heading' | 'quotation' | 'author-signature' = 'body'
): DocumentContentJson => ({
  type: 'paragraph',
  attrs: { documentStyleId },
  content: [{ type: 'text', text }],
});

const document = (...content: DocumentContentJson[]): DocumentContentJson => ({
  type: 'doc',
  content,
});

type FixtureImageOptions = {
  id: string;
  assetId: string;
  altText: string;
  widthPx: number;
  heightPx: number;
  yPx: number;
  xOffsetPx?: number;
  spanStartColumn?: 1 | 2 | 3;
  spanCount?: 1 | 2 | 3;
  horizontalPlacement?: 'left' | 'center' | 'right' | 'custom';
  naturalWidth?: number;
  naturalHeight?: number;
  caption: string;
};

const positionedImage = ({
  id,
  assetId,
  altText,
  widthPx,
  heightPx,
  yPx,
  xOffsetPx = 0,
  spanStartColumn = 1,
  spanCount = 1,
  horizontalPlacement = 'custom',
  naturalWidth = widthPx * 4,
  naturalHeight = heightPx * 4,
  caption,
}: FixtureImageOptions): DocumentContentJson => ({
  type: 'documentFlowImage',
  attrs: {
    id,
    assetId,
    altText,
    widthPx,
    heightPx,
    naturalWidth,
    naturalHeight,
    wrap: 'span-columns',
    spanCount,
    spanStartColumn,
    verticalAnchor: 'page-position',
    horizontalPlacement,
    coordinateSpace: 'body-span',
    xOffsetPx,
    yPx,
    wrapPaddingTopPx: 12,
    wrapPaddingRightPx: 12,
    wrapPaddingBottomPx: 12,
    wrapPaddingLeftPx: 12,
    caption,
    captionAlignment: 'center',
    captionItalic: true,
    captionSpacingPx: 8,
  },
});

const pageShell = (
  folio: number,
  name: string,
  bodyContent: DocumentContentJson,
  options: Partial<Pick<DocumentPage, 'titleContent' | 'columnCount' | 'columnGapPx' | 'dropCap' | 'margins' | 'imageGroups' | 'suppressTitle'>> = {}
): Record<string, unknown> => ({
  kind: 'document',
  id: `historical-page-${folio}`,
  name,
  size: {
    presetId: 'letter',
    orientation: 'portrait',
    widthIn: 8.5,
    heightIn: 11,
    dpi: 300,
  },
  margins: options.margins || {
    topIn: 0.55,
    bottomIn: 0.7,
    innerIn: 0.72,
    outerIn: 0.48,
  },
  titleContent: options.titleContent || document(
    paragraph(`Historische Seiten ${folio}`, 'article-title')
  ),
  bodyContent,
  columnCount: options.columnCount || 3,
  columnGapPx: options.columnGapPx || 20,
  language: 'de',
  dropCap: options.dropCap || { ...DEFAULT_DOCUMENT_DROP_CAP },
  ...(options.suppressTitle ? { suppressTitle: true } : {}),
  suppressFolio: false,
  overlayObjects: [],
  imageGroups: options.imageGroups || [],
});

const group = (
  id: string,
  kind: DocumentImageGroup['kind'],
  childImageIds: string[],
  gapPx = 18,
  sharedWidth = false
): DocumentImageGroup => ({
  id,
  kind,
  childImageIds,
  gapPx,
  sharedWidth,
});

const assetMetadata = (
  source: string,
  fileName: string,
  metadata: {
    mimeType: string;
    byteLength: number;
    naturalWidth: number;
    naturalHeight: number;
  } = {
    mimeType: 'image/png',
    byteLength: FIXTURE_PNG.length,
    naturalWidth: 1200,
    naturalHeight: 800,
  }
) => ({
  contentHash: fingerprintDocumentAssetSource(source),
  byteLength: metadata.byteLength,
  mimeType: metadata.mimeType,
  naturalWidth: metadata.naturalWidth,
  naturalHeight: metadata.naturalHeight,
  fileName,
});

const PAGE_50_ASSETS = {
  [HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Left]: PAGE_50_LEFT_ASSET,
  [HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Right]: PAGE_50_RIGHT_ASSET,
} as const;

const PAGE_50_ASSET_METADATA = {
  [HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Left]: assetMetadata(
    PAGE_50_LEFT_ASSET,
    'page50-left.jpg',
    {
      mimeType: 'image/jpeg',
      byteLength: 1_542_782,
      naturalWidth: 1600,
      naturalHeight: 2376,
    }
  ),
  [HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Right]: assetMetadata(
    PAGE_50_RIGHT_ASSET,
    'page50-right.jpg',
    {
      mimeType: 'image/jpeg',
      byteLength: 1_048_282,
      naturalWidth: 1600,
      naturalHeight: 2312,
    }
  ),
} as const;

const PAGE_49_BODY = document(
  paragraph(
    'Am Anfang dieser beispielhaften Seite steht ein kurzer deutscher Absatz. '
      + 'Er zeigt den dreispaltigen Satz, die laufende Rechtfertigung und den '
      + 'grossen Initialbuchstaben, ohne eine historische Transkription zu behaupten.'
  ),
  paragraph(
    'Weitere repräsentative Zeilen halten den Textfluss oberhalb der Abbildung '
      + 'offen. Die Seite bleibt bewusst editierbar und kann mit einer später '
      + 'bereitgestellten Transkription ersetzt werden.'
  ),
  positionedImage({
    id: 'historical-image-49',
    assetId: HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page49,
    altText: 'Placeholder photograph for historical page 49',
    widthPx: 410,
    heightPx: 268,
    yPx: 565,
    spanStartColumn: 2,
    spanCount: 2,
    caption: 'Beispielabbildung — Bildunterschrift bleibt am Bild gebunden',
  }),
  paragraph(
    'Der Text setzt unterhalb der Abbildung fort und demonstriert die stabile '
      + 'Ausschlussfläche für Bild und Bildunterschrift.'
  )
);

const PAGE_50_BODY = document(
  paragraph('Tariverde', 'subsection-heading'),
  paragraph(
    'Dieser editierbare deutsche Beispielabsatz bildet den ruhigen Buchsatz der '
      + 'Vorlage nach. Er hält die schmale Serifenschrift, die laufende '
      + 'Rechtfertigung und den kompakten Zeilenfall der oberen Satzfläche fest. '
      + 'Die repräsentativen Sätze sind bewusst keine nicht verifizierte '
      + 'Transkription; sie können später durch eine geprüfte Fassung ersetzt '
      + 'werden. So bleibt die historische Seite in drei schmalen Spalten '
      + 'bearbeitbar, ohne den sichtbaren Charakter der Vorlage zu verlieren.'
  ),
  paragraph(
    'Die mittlere Satzspalte setzt den repräsentativen Textfluss fort. Längere '
      + 'deutsche Wörter und Satzzeichen zeigen die typografische Dichte. Die '
      + 'untere Bildreihe bleibt als eigenständige '
      + 'Objektgruppe vom Textfluss getrennt. Jede Abbildung hat ihre eigene '
      + 'Bildunterschrift und kann unabhängig ausgewählt, verschoben und '
      + 'bearbeitet werden. Reihenfolge und Abstand der Bildreihe bleiben beim '
      + 'Speichern und erneuten Öffnen erhalten. Zusätzliche repräsentative Zeilen '
      + 'halten die drei oberen Spalten in einem gleichmäßigen Rhythmus. Sie '
      + 'bleiben bewusst neutral und dienen nur der editierbaren Gestaltung '
      + 'dieser historischen Buchseite. Die drei oberen Spalten bleiben dadurch '
      + 'als ruhige Satzfläche geschlossen. Der obere Bereich endet damit klar '
      + 'vor der Bildgruppe.'
  ),
  paragraph('Karatai (Nisipari)', 'subsection-heading'),
  paragraph(
    'Repräsentativer Anschluss; die geprüfte Transkription bleibt offen.'
  ),
  positionedImage({
    id: 'historical-image-50-left',
    assetId: HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Left,
    altText: 'Karatai cemetery, the only German grave',
    widthPx: 350,
    heightPx: 520,
    naturalWidth: 1600,
    naturalHeight: 2376,
    yPx: 390,
    spanStartColumn: 1,
    spanCount: 3,
    horizontalPlacement: 'center',
    caption: 'Karatai - Friedhof, einziges deutsches Grab',
  }),
  positionedImage({
    id: 'historical-image-50-right',
    assetId: HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page50Right,
    altText: 'Karatai street sign, Deutsche Straße',
    widthPx: 340,
    heightPx: 491,
    naturalWidth: 1600,
    naturalHeight: 2312,
    yPx: 390,
    spanStartColumn: 1,
    spanCount: 3,
    horizontalPlacement: 'center',
    caption: 'Karatai - Straßenschild Deutsche Straße',
  })
);

const PAGE_51_BODY = document(
  paragraph(
    'Schmale linke Textspalte mit einem repräsentativen deutschen Platzhalter. '
      + 'Die rechte Hälfte bleibt für den vertikalen Bildstapel reserviert.'
  ),
  paragraph(
    'Kurzer Folgeabsatz für den Nachweis, dass Text und Bilder beim Verschieben '
      + 'unabhängig reflowen und gespeichert werden.'
  ),
  positionedImage({
    id: 'historical-image-51-top',
    assetId: HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page51Top,
    altText: 'Placeholder upper photograph for historical page 51',
    widthPx: 280,
    heightPx: 175,
    yPx: 175,
    spanStartColumn: 2,
    spanCount: 2,
    caption: 'Obere Beispielabbildung',
  }),
  positionedImage({
    id: 'historical-image-51-bottom',
    assetId: HISTORICAL_BOOK_FIXTURE_ASSET_IDS.page51Bottom,
    altText: 'Placeholder lower photograph for historical page 51',
    widthPx: 280,
    heightPx: 275,
    yPx: 175,
    spanStartColumn: 2,
    spanCount: 2,
    caption: 'Untere Beispielabbildung',
  })
);

const PAGE_52_BODY = document(
  paragraph('Erster Beispielabschnitt für den dreispaltigen Schluss.'),
  paragraph('Ein weiterer Abschnitt', 'subsection-heading'),
  paragraph(
    'Mehrere kurze Absätze bilden die redaktionelle Hierarchie der Schlussseite '
      + 'ab, ohne unbekannte historische Inhalte zu erfinden.'
  ),
  paragraph('Schlussgedanke', 'subsection-heading'),
  paragraph(
    'Der letzte kurze Textblock darf vor dem unteren Seitenrand enden und lässt '
      + 'den natürlichen Leerraum der Vorlage sichtbar.'
  ),
  paragraph(
    '„Dies ist ein repräsentatives Zitat für die Satz- und Einrückungsprobe.“',
    'quotation'
  ),
  paragraph('Beispielautor', 'author-signature')
);

/**
 * Builds the four-page acceptance fixture used by unit, export, and browser
 * tests. Page 50 uses the supplied source photographs; its body paragraphs
 * remain representative placeholders because a verified transcription is not
 * part of this repository.
 */
export const createHistoricalBookFixtureProject = (): DocumentProjectPayload => {
  const pages = [
    pageShell(49, 'Historische Seite 49', PAGE_49_BODY, {
      titleContent: document(
        paragraph('Die Geschichte eines Hauses', 'article-title'),
        paragraph('Erinnerungen und Bilder aus alter Zeit', 'article-title')
      ),
      dropCap: {
        enabled: true,
        fontFamilyId: 'historical-serif',
        color: '#285F9E',
        sizeEm: 3.4,
        lineSpan: 3,
        spacingPx: 7,
      },
    }),
    pageShell(50, 'Historische Seite 50', PAGE_50_BODY, {
      titleContent: document({ type: 'paragraph' }),
      suppressTitle: true,
      imageGroups: [group(
        'historical-row-50',
        'row',
        ['historical-image-50-left', 'historical-image-50-right'],
        22
      )],
    }),
    pageShell(51, 'Historische Seite 51', PAGE_51_BODY, {
      margins: {
        topIn: 0.55,
        bottomIn: 0.7,
        innerIn: 0.72,
        outerIn: 0.48,
      },
      imageGroups: [group(
        'historical-stack-51',
        'stack',
        ['historical-image-51-top', 'historical-image-51-bottom'],
        24,
        false
      )],
    }),
    pageShell(52, 'Historische Seite 52', PAGE_52_BODY),
  ];

  return normalizeDesignSpaceProjectPayload({
    schemaVersion: 'design-space-project-v2',
    editorMode: 'document',
    projectId: 'historical-book-fixture',
    projectName: 'Historical Book Pages 49–52 Fixture',
    metadata: {
      name: 'Historical Book Pages 49–52 Fixture',
      sourceApp: 'design-space',
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-01T00:00:00.000Z',
    document: {
      schemaVersion: 5,
      language: 'de',
      styles: JSON.parse(JSON.stringify(DEFAULT_DOCUMENT_STYLES)),
      folios: {
        startingNumber: 49,
        visible: true,
        placement: 'outside-bottom',
      },
      background: {
        tokenRole: 'paper',
        value: '#FAF8F5',
      },
    },
    pages,
    assets: {
      ...Object.fromEntries(
      Object.values(HISTORICAL_BOOK_FIXTURE_ASSET_IDS)
        .map((assetId) => [assetId, FIXTURE_PNG])
      ),
      ...PAGE_50_ASSETS,
    },
    assetMetadata: {
      ...Object.fromEntries(
      Object.entries(HISTORICAL_BOOK_FIXTURE_ASSET_IDS)
          .map(([name, assetId]) => [
            assetId,
            assetMetadata(FIXTURE_PNG, `${name}.png`),
          ])
      ),
      ...PAGE_50_ASSET_METADATA,
    },
    activePageIndex: 0,
  }, {
    editorMode: 'document',
    projectId: 'historical-book-fixture',
    projectName: 'Historical Book Pages 49–52 Fixture',
    now: '2026-01-01T00:00:00.000Z',
  }) as DocumentProjectPayload;
};

export const historicalBookFixtureProject = createHistoricalBookFixtureProject();

export const historicalBookFixtureJson = (): string => JSON.stringify(
  createHistoricalBookFixtureProject()
);

export const historicalBookFixturePages = (): readonly DocumentPage[] => (
  createHistoricalBookFixtureProject().pages
);

export type HistoricalBookFixturePageContent = JSONContent;
