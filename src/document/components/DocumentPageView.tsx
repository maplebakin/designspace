import React from 'react';
import type {
  DocumentContentJson,
  DocumentOverlayImage,
  DocumentPage,
  ScanReference,
} from '../types/documentProject';
import { DocumentOverlayLayer } from './DocumentOverlayLayer';
import { ScanReferenceLayer } from './ScanReferenceLayer';
import {
  DOCUMENT_CSS_PIXELS_PER_INCH,
  getDocumentOutsideEdge,
  getDocumentPageParity,
  resolveDocumentPhysicalMargins,
} from '../layout/pageGeometry';
import type {
  DocumentNamedStyleRegistry,
} from '../typography/documentTypography';
import {
  getDocumentTypographyCssVariables,
} from '../typography/documentTypographyCss';

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
  folioNumber: number;
  showFolio: boolean;
  documentLanguage: string;
  typographyStyles: DocumentNamedStyleRegistry;
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
  folioNumber,
  showFolio,
  documentLanguage,
  typographyStyles,
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
  const widthPx = page.size.widthIn * DOCUMENT_CSS_PIXELS_PER_INCH;
  const heightPx = page.size.heightIn * DOCUMENT_CSS_PIXELS_PER_INCH;
  const physicalMargins = resolveDocumentPhysicalMargins(
    page.margins,
    folioNumber
  );
  const parity = getDocumentPageParity(folioNumber);
  const outsideEdge = getDocumentOutsideEdge(folioNumber);
  const marginStyle = {
    paddingTop: `${physicalMargins.topIn * DOCUMENT_CSS_PIXELS_PER_INCH}px`,
    paddingRight: `${physicalMargins.rightIn * DOCUMENT_CSS_PIXELS_PER_INCH}px`,
    paddingBottom: `${physicalMargins.bottomIn * DOCUMENT_CSS_PIXELS_PER_INCH}px`,
    paddingLeft: `${physicalMargins.leftIn * DOCUMENT_CSS_PIXELS_PER_INCH}px`,
  };
  const language = page.language || documentLanguage;
  const typographyStyle = getDocumentTypographyCssVariables(
    typographyStyles,
    page.dropCap
  );

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
          lang={language}
          style={{
            ...typographyStyle,
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
            data-page-id={page.id}
            data-folio-number={folioNumber}
            data-page-parity={parity}
            data-folio-side={outsideEdge}
            data-paper-color={paperColor}
            data-document-language={language}
            lang={language}
            style={{
              ...typographyStyle,
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
              pageWidthPx={widthPx}
              pageHeightPx={heightPx}
              onSelect={onSelectOverlay}
              onChange={onUpdateOverlay}
            />

            <div className="document-page-content" style={marginStyle}>
              <section
                className="document-title-region"
                data-testid="document-title-region"
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
                className={`document-body-region ${
                  page.dropCap.enabled ? 'document-drop-cap' : ''
                }`}
                data-document-drop-cap={
                  page.dropCap.enabled ? 'true' : 'false'
                }
                data-drop-cap-line-span={page.dropCap.lineSpan}
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
              pageWidthPx={widthPx}
              pageHeightPx={heightPx}
              onSelect={onSelectOverlay}
              onChange={onUpdateOverlay}
            />

            {showFolio && !page.suppressFolio && (
              <div
                className={`document-page-folio document-page-folio--${outsideEdge}`}
                data-testid="document-folio"
                data-folio-number={folioNumber}
                data-folio-side={outsideEdge}
                aria-label={`Page ${folioNumber}`}
                style={{
                  bottom: `${
                    Math.max(
                      12,
                      physicalMargins.bottomIn
                        * DOCUMENT_CSS_PIXELS_PER_INCH
                        * 0.5
                    )
                  }px`,
                  [outsideEdge]: `${
                    Math.max(
                      12,
                      physicalMargins[outsideEdge === 'left' ? 'leftIn' : 'rightIn']
                        * DOCUMENT_CSS_PIXELS_PER_INCH
                        * 0.5
                    )
                  }px`,
                }}
              >
                {folioNumber}
              </div>
            )}
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
