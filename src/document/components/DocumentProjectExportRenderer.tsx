import { useEffect, useMemo, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { JSONContent } from '@tiptap/core';
import type { DocumentProjectPayload } from '../../editor/project/projectSchema';
import type { DocumentPage } from '../types/documentProject';
import {
  type DocumentExportPageSource,
} from '../services/documentExportService';
import {
  getDocumentFolioNumber,
  resolveDocumentPhysicalMargins,
} from '../layout/pageGeometry';
import { DEFAULT_DOCUMENT_PAPER_COLOR } from '../utils/documentColor';
import {
  getDocumentTypographyCssVariables,
} from '../typography/documentTypographyCss';
import { DocumentPageView } from './DocumentPageView';
import { TitleEditor } from './TitleEditor';
import { FlowEditor } from './FlowEditor';

type ExportPageSurfaceProps = {
  page: DocumentPage;
  pageIndex: number;
  project: DocumentProjectPayload;
  onRootReady: (pageIndex: number, root: HTMLDivElement) => void;
};

const ExportPageSurface = ({
  page,
  pageIndex,
  project,
  onRootReady,
}: ExportPageSurfaceProps) => {
  const exportRootRef = useRef<HTMLDivElement | null>(null);
  const folioNumber = getDocumentFolioNumber(
    project.document.folios.startingNumber,
    pageIndex
  );
  const physicalMargins = resolveDocumentPhysicalMargins(
    page.margins,
    folioNumber
  );
  const bodyWidthPx = Math.max(
    1,
    (
      page.size.widthIn
      - physicalMargins.leftIn
      - physicalMargins.rightIn
    ) * 96
  );
  const columnWidthPx = Math.max(
    1,
    (
      bodyWidthPx - page.columnGapPx * (page.columnCount - 1)
    ) / page.columnCount
  );
  const assetSources = useMemo(() => project.assets || {}, [project.assets]);
  const language = page.language || project.document.language;
  const typographyStyle = useMemo(
    () => getDocumentTypographyCssVariables(
      project.document.styles,
      page.dropCap
    ),
    [page.dropCap, project.document.styles]
  );

  useEffect(() => {
    if (exportRootRef.current) {
      onRootReady(pageIndex, exportRootRef.current);
    }
  }, [onRootReady, pageIndex]);

  return (
    <DocumentPageView
      page={{ ...page, reference: undefined }}
      assetSources={assetSources}
      paperColor={
        project.document.background?.value || DEFAULT_DOCUMENT_PAPER_COLOR
      }
      folioNumber={folioNumber}
      showFolio={project.document.folios.visible}
      documentLanguage={project.document.language}
      typographyStyles={project.document.styles}
      zoom={1}
      exportRootRef={exportRootRef}
      referenceAdjustMode={false}
      selectedOverlayId={null}
      isOverflowing={false}
      onReferenceChange={() => undefined}
      onSelectOverlay={() => undefined}
      onUpdateOverlay={() => undefined}
      titleEditor={(
        <TitleEditor
          content={page.titleContent as JSONContent}
          editable={false}
          ariaLabel={`Export title for page ${folioNumber}`}
          baseFontSizePx={
            project.document.styles['article-title'].fontSizePx
          }
          language={language}
        />
      )}
      bodyEditor={(
        <FlowEditor
          content={page.bodyContent as JSONContent}
          editable={false}
          ariaLabel={`Export body for page ${folioNumber}`}
          columnCount={page.columnCount}
          columnGapPx={page.columnGapPx}
          dropCap={page.dropCap}
          language={language}
          typographyStyle={typographyStyle}
          viewScale={1}
          maxImageWidthPx={Math.max(180, columnWidthPx)}
          maxSpanImageWidthPx={bodyWidthPx}
          imageGroups={page.imageGroups}
          resolveAssetSource={(assetId) => assetSources[assetId]}
        />
      )}
    />
  );
};

type CommittedDocumentPagesProps = {
  project: DocumentProjectPayload;
  onRootReady: (pageIndex: number, root: HTMLDivElement) => void;
};

const CommittedDocumentPages = ({
  project,
  onRootReady,
}: CommittedDocumentPagesProps) => (
  <>
    {project.pages.map((page, pageIndex) => (
      <ExportPageSurface
        key={page.id}
        page={page}
        pageIndex={pageIndex}
        project={project}
        onRootReady={onRootReady}
      />
    ))}
  </>
);

export type MountedDocumentExportPages = {
  project: DocumentProjectPayload;
  sources: DocumentExportPageSource[];
  cleanup: () => void;
};

const nextAnimationFrame = () => new Promise<void>((resolve) => {
  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => resolve());
  } else {
    window.setTimeout(resolve, 0);
  }
});

// Four-page historical fixtures can legitimately require several layout
// passes before every Tiptap surface reports its export root. Keep this bound
// finite while allowing slower CI/browser font environments to finish.
export const DOCUMENT_EXPORT_MOUNT_TIMEOUT_MS = 15_000;

const cloneCommittedProject = (
  project: DocumentProjectPayload
): DocumentProjectPayload => JSON.parse(JSON.stringify(project));

/**
 * Mounts a frozen project snapshot offscreen at true 96-CSS-pixel page scale.
 * The host remains laid out (rather than display:none) so browser text and
 * structured exclusion measurement behave exactly as they do in the editor.
 */
export const mountCommittedDocumentExportPages = async (
  project: DocumentProjectPayload
): Promise<MountedDocumentExportPages> => {
  if (typeof document === 'undefined') {
    throw new Error('Document export rendering is unavailable.');
  }
  const snapshot = cloneCommittedProject(project);
  const host = document.createElement('div');
  host.setAttribute('data-document-committed-export-host', 'true');
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: '1px',
    height: '1px',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(host);

  let reactRoot: Root | null = createRoot(host);
  const pageRoots: Array<HTMLDivElement | undefined> = Array.from({
    length: snapshot.pages.length,
  });
  let resolveRoots: (() => void) | null = null;
  const rootsReady = new Promise<void>((resolve) => {
    resolveRoots = resolve;
  });
  const onRootReady = (pageIndex: number, root: HTMLDivElement) => {
    pageRoots[pageIndex] = root;
    if (pageRoots.every(Boolean)) resolveRoots?.();
  };

  const cleanup = () => {
    reactRoot?.unmount();
    reactRoot = null;
    host.remove();
  };

  reactRoot.render(
    <CommittedDocumentPages
      project={snapshot}
      onRootReady={onRootReady}
    />
  );

  let timeoutId: number | undefined;
  try {
    await Promise.race([
      rootsReady,
      new Promise<never>((_resolve, reject) => {
        timeoutId = window.setTimeout(() => {
          reject(new Error('Committed document pages did not finish mounting.'));
        }, DOCUMENT_EXPORT_MOUNT_TIMEOUT_MS);
      }),
    ]);
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    if (document.fonts?.ready) await document.fonts.ready;
    await nextAnimationFrame();
    await nextAnimationFrame();
    await nextAnimationFrame();

    return {
      project: snapshot,
      sources: snapshot.pages.map((page, pageIndex) => ({
        pageId: page.id,
        element: pageRoots[pageIndex] as HTMLDivElement,
        options: {
          widthIn: page.size.widthIn,
          heightIn: page.size.heightIn,
          dpi: page.size.dpi,
          fileName: snapshot.projectName,
          backgroundColor:
            snapshot.document.background?.value || DEFAULT_DOCUMENT_PAPER_COLOR,
        },
      })),
      cleanup,
    };
  } catch (error) {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    cleanup();
    throw error;
  }
};
