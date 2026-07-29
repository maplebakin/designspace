import React from 'react';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../types/documentProject';
import { DocumentOverlayLayer } from './DocumentOverlayLayer';
import { ScanReferenceLayer } from './ScanReferenceLayer';

const CSS_PIXELS_PER_INCH = 96;

export const hasMeaningfulDocumentContent = (
  content?: DocumentContentJson
): boolean => {
  if (!content) return false;
  if (typeof content.text === 'string' && content.text.trim().length > 0) {
    return true;
  }
  if (
    content.type === 'documentInlineImage'
    || content.type === 'documentFlowImage'
  ) {
    return true;
  }
  return (content.content || []).some(hasMeaningfulDocumentContent);
};

type DocumentPageViewProps = {
  page: DocumentPage;
  assetSources: Record<string, string>;
  paperColor: string;
  zoom: number;
  titleEditor: React.ReactNode;
  bodyEditor: React.ReactNode;
  exportRootRef: React.RefObject<HTMLDivElement | null>;
  referenceAdjustMode: boolean;
  selectedOverlayId: string | null;
  isOverflowing: boolean;
  onReferenceChange: (update: Partial<ScanReference>) => void;
  onSelectOverlay: (id: string | null) => void;
  onUpdateOverlay: (id: string, update: Partial<DocumentOverlayImage>) => void;
};

export const DocumentPageView: React.FC<DocumentPageViewProps> = ({
  page,
  assetSources,
  paperColor,
  zoom,
  titleEditor,
  bodyEditor,
  exportRootRef,
  referenceAdjustMode,
  selectedOverlayId,
  isOverflowing,
  onReferenceChange,
  onSelectOverlay,
  onUpdateOverlay,
}) => {
  const widthPx = page.size.widthIn * CSS_PIXELS_PER_INCH;
  const heightPx = page.size.heightIn * CSS_PIXELS_PER_INCH;
  const marginStyle = {
    paddingTop: `${page.margins.topIn * CSS_PIXELS_PER_INCH}px`,
    paddingRight: `${page.margins.rightIn * CSS_PIXELS_PER_INCH}px`,
    paddingBottom: `${page.margins.bottomIn * CSS_PIXELS_PER_INCH}px`,
    paddingLeft: `${page.margins.leftIn * CSS_PIXELS_PER_INCH}px`,
  };

  return (
    <div
      className="document-page-viewport"
      style={{
        width: widthPx * zoom,
        height: heightPx * zoom,
      }}
    >
      <div
        className="document-page-transform"
        style={{
          width: widthPx,
          height: heightPx,
          transform: `scale(${zoom})`,
        }}
      >
        <div
          className="document-page-sheet"
          data-testid="document-page"
          style={{
            width: widthPx,
            height: heightPx,
            backgroundColor: paperColor,
          }}
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) onSelectOverlay(null);
          }}
        >
          <ScanReferenceLayer
            reference={page.reference}
            source={page.reference ? assetSources[page.reference.assetId] : undefined}
            adjustMode={referenceAdjustMode}
            zoom={zoom}
            onChange={onReferenceChange}
          />

          <div
            ref={exportRootRef}
            className="document-page-export-root"
            data-document-export-root="true"
            data-testid="document-export-root"
            data-page-width-in={page.size.widthIn}
            data-page-height-in={page.size.heightIn}
            data-page-orientation={page.size.orientation}
            data-paper-color={paperColor}
            style={{
              width: widthPx,
              height: heightPx,
              backgroundColor: paperColor,
            }}
          >
            <DocumentOverlayLayer
              placement="behind"
              objects={page.overlayObjects}
              assetSources={assetSources}
              selectedId={selectedOverlayId}
              zoom={zoom}
              onSelect={onSelectOverlay}
              onChange={onUpdateOverlay}
            />

            <div className="document-page-content" style={marginStyle}>
              <section
                className="document-title-region"
                data-testid="document-title-region"
                style={{ fontSize: page.titleFontSizePx }}
              >
                {!hasMeaningfulDocumentContent(page.titleContent) && (
                  <span
                    className="document-page-placeholder document-page-placeholder--title"
                    data-document-export-exclude="true"
                    data-testid="document-title-placeholder"
                    aria-hidden="true"
                  >
                    Add a title
                  </span>
                )}
                {titleEditor}
              </section>
              <section
                className={`document-body-region ${page.dropCap ? 'document-drop-cap' : ''}`}
                data-document-drop-cap={page.dropCap ? 'true' : 'false'}
                data-testid="document-body-region"
                style={{
                  '--document-column-count': page.columnCount,
                  '--document-column-gap': `${page.columnGapPx}px`,
                } as React.CSSProperties}
              >
                {!hasMeaningfulDocumentContent(page.bodyContent) && (
                  <span
                    className="document-page-placeholder document-page-placeholder--body"
                    data-document-export-exclude="true"
                    data-testid="document-body-placeholder"
                    aria-hidden="true"
                  >
                    Start writing or paste translated text…
                  </span>
                )}
                {bodyEditor}
              </section>
            </div>

            <DocumentOverlayLayer
              placement="front"
              objects={page.overlayObjects}
              assetSources={assetSources}
              selectedId={selectedOverlayId}
              zoom={zoom}
              onSelect={onSelectOverlay}
              onChange={onUpdateOverlay}
            />
          </div>
        </div>
      </div>

      {isOverflowing && (
        <div
          className="document-overflow-warning"
          data-document-export-exclude="true"
          data-document-overflow-warning="true"
          data-testid="document-overflow-warning"
          role="status"
        >
          Content extends beyond this single page. Shorten the text or reduce its layout.
        </div>
      )}
    </div>
  );
};
