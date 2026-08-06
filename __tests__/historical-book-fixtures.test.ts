import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  getDocumentFolioNumber,
  getDocumentOutsideEdge,
} from '../src/document/layout/pageGeometry';
import {
  mountCommittedDocumentExportPages,
} from '../src/document/components/DocumentProjectExportRenderer';
import {
  createHistoricalBookFixtureProject,
  historicalBookFixturePages,
} from '../src/document/fixtures/historicalBookFixtures';
import type { DocumentContentJson } from '../src/document/types/documentProject';
import { normalizeDesignSpaceProjectPayload } from '../src/editor/project/projectSchema';

const walk = (
  content: DocumentContentJson,
  visit: (node: DocumentContentJson) => void
) => {
  visit(content);
  (content.content || []).forEach((child) => walk(child, visit));
};

const images = (content: DocumentContentJson) => {
  const result: DocumentContentJson[] = [];
  walk(content, (node) => {
    if (node.type === 'documentFlowImage' || node.type === 'documentInlineImage') {
      result.push(node);
    }
  });
  return result;
};

describe('historical book page fixtures', () => {
  it('creates four independently editable German pages with mirrored folios', () => {
    const project = createHistoricalBookFixtureProject();

    expect(project.editorMode).toBe('document');
    expect(project.document.language).toBe('de');
    expect(project.document.background?.value).toBe('#FAF8F5');
    expect(project.pages.map((page) => page.id)).toEqual([
      'historical-page-49',
      'historical-page-50',
      'historical-page-51',
      'historical-page-52',
    ]);
    expect(project.pages.map((_page, index) => getDocumentFolioNumber(49, index)))
      .toEqual([49, 50, 51, 52]);
    expect(project.pages.map((_page, index) => getDocumentOutsideEdge(49 + index)))
      .toEqual(['right', 'left', 'right', 'left']);
  });

  it('exercises the page 49 title, drop cap, wrapping image, and caption', () => {
    const page = historicalBookFixturePages()[0];
    const titleText = page.titleContent.content
      ?.map((node) => node.content?.[0]?.text)
      .join(' ');
    const pageImages = images(page.bodyContent);

    expect(page.columnCount).toBe(3);
    expect(titleText).toContain('Die Geschichte eines Hauses');
    expect(titleText).toContain('Erinnerungen und Bilder');
    expect(page.dropCap).toMatchObject({
      enabled: true,
      color: '#285F9E',
      lineSpan: 3,
    });
    expect(pageImages).toHaveLength(1);
    expect(pageImages[0].attrs).toMatchObject({
      id: 'historical-image-49',
      wrap: 'span-columns',
      verticalAnchor: 'page-position',
      spanCount: 2,
      spanStartColumn: 2,
      captionAlignment: 'center',
      captionItalic: true,
    });
  });

  it('exercises page 50 subsection roles and an independently captioned row', () => {
    const project = createHistoricalBookFixtureProject();
    const page = project.pages[1];
    const pageImages = images(page.bodyContent);
    const headings = (page.bodyContent.content || [])
      .filter((node) => node.attrs?.documentStyleId === 'subsection-heading');

    expect(page.columnCount).toBe(3);
    expect(page.suppressTitle).toBe(true);
    expect(getDocumentFolioNumber(49, 1)).toBe(50);
    expect(getDocumentOutsideEdge(50)).toBe('left');
    expect(page.titleContent.content).toHaveLength(1);
    expect(page.titleContent.content?.[0]).toMatchObject({ type: 'paragraph' });
    expect(headings.map((heading) => heading.content?.[0]?.text)).toEqual([
      'Tariverde',
      'Karatai (Nisipari)',
    ]);
    expect(headings).toHaveLength(2);
    expect(page.imageGroups).toEqual([{
      id: 'historical-row-50',
      kind: 'row',
      childImageIds: ['historical-image-50-left', 'historical-image-50-right'],
      gapPx: 22,
      sharedWidth: false,
    }]);
    expect(pageImages).toHaveLength(2);
    expect(pageImages.map((image) => image.attrs?.widthPx)).toEqual([350, 340]);
    expect(pageImages.map((image) => image.attrs?.naturalWidth)).toEqual([1600, 1600]);
    expect(pageImages.map((image) => image.attrs?.naturalHeight)).toEqual([2376, 2312]);
    expect(pageImages.every((image) => (
      image.attrs?.spanStartColumn === 1
      && image.attrs?.spanCount === 3
      && image.attrs?.verticalAnchor === 'page-position'
      && image.attrs?.horizontalPlacement === 'center'
      && image.attrs?.yPx === 390
    ))).toBe(true);
    expect(pageImages.map((image) => image.attrs?.caption)).toEqual([
      'Karatai - Friedhof, einziges deutsches Grab',
      'Karatai - Straßenschild Deutsche Straße',
    ]);
    expect(pageImages.map((image) => image.attrs?.assetId)).toEqual([
      'historical-photo-50-left',
      'historical-photo-50-right',
    ]);
    expect(project.assets['historical-photo-50-left']).toBe(
      '/historical-book/page50-left.jpg'
    );
    expect(project.assets['historical-photo-50-right']).toBe(
      '/historical-book/page50-right.jpg'
    );
    expect(project.assetMetadata['historical-photo-50-left']).toMatchObject({
      mimeType: 'image/jpeg',
      naturalWidth: 1600,
      naturalHeight: 2376,
    });
    expect(project.assetMetadata['historical-photo-50-right']).toMatchObject({
      mimeType: 'image/jpeg',
      naturalWidth: 1600,
      naturalHeight: 2312,
    });
  });

  it('exercises page 51 narrow text beside a different-height image stack', () => {
    const page = historicalBookFixturePages()[2];
    const pageImages = images(page.bodyContent);

    expect(page.columnCount).toBe(3);
    expect(page.imageGroups[0]).toMatchObject({
      id: 'historical-stack-51',
      kind: 'stack',
      childImageIds: ['historical-image-51-top', 'historical-image-51-bottom'],
      gapPx: 24,
      sharedWidth: false,
    });
    expect(pageImages.map((image) => image.attrs?.heightPx)).toEqual([175, 275]);
    expect(pageImages.every((image) => (
      image.attrs?.spanStartColumn === 2
      && image.attrs?.spanCount === 2
    ))).toBe(true);
  });

  it('exercises page 52 heading, quotation, signature, and natural short ending', () => {
    const page = historicalBookFixturePages()[3];
    const styles = (page.bodyContent.content || [])
      .map((node) => node.attrs?.documentStyleId);

    expect(styles).toContain('subsection-heading');
    expect(styles).toContain('quotation');
    expect(styles).toContain('author-signature');
    expect(page.bodyContent.content).toHaveLength(7);
    expect(page.imageGroups).toEqual([]);
  });

  it('survives portable JSON round-trip without changing layout or groups', () => {
    const source = createHistoricalBookFixtureProject();
    const reopened = normalizeDesignSpaceProjectPayload(
      JSON.parse(JSON.stringify(source)),
      { editorMode: 'document' }
    );

    expect(reopened).toEqual(source);
    const page50 = reopened.pages[1];
    expect(page50.imageGroups[0].childImageIds).toEqual([
      'historical-image-50-left',
      'historical-image-50-right',
    ]);
    expect(page50.bodyContent.content?.slice(-2).map((node) => node.attrs)).toEqual([
      expect.objectContaining({
        assetId: 'historical-photo-50-left',
        caption: 'Karatai - Friedhof, einziges deutsches Grab',
        widthPx: 350,
      }),
      expect.objectContaining({
        assetId: 'historical-photo-50-right',
        caption: 'Karatai - Straßenschild Deutsche Straße',
        widthPx: 340,
      }),
    ]);
  });

  it('mounts all four committed fixture pages in export order', async () => {
    const project = createHistoricalBookFixtureProject();
    let mounted: Awaited<ReturnType<typeof mountCommittedDocumentExportPages>> | undefined;
    try {
      let mountPromise!: ReturnType<typeof mountCommittedDocumentExportPages>;
      act(() => {
        mountPromise = mountCommittedDocumentExportPages(project);
      });
      mounted = await mountPromise;
      expect(mounted?.sources.map((source) => source.pageId)).toEqual([
        'historical-page-49',
        'historical-page-50',
        'historical-page-51',
        'historical-page-52',
      ]);
      expect(mounted?.sources.map((source) => source.element.getAttribute('data-folio-number')))
        .toEqual(['49', '50', '51', '52']);
      expect(mounted?.sources.map((source) => source.element.querySelectorAll(
        '[data-document-image="true"]'
      ).length)).toEqual([2, 4, 4, 0]);
      expect(mounted?.sources[0].element.querySelector('[data-document-drop-cap="true"]'))
        .not.toBeNull();
    } finally {
      mounted?.cleanup();
    }
  }, 30_000);
});
