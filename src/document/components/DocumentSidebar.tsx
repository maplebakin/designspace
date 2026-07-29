import React, { useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileImage,
  ImagePlus,
  Lock,
  RotateCcw,
} from 'lucide-react';
import type {
  DocumentFolioSettings,
  DocumentOverlayImage,
  DocumentPage,
} from '../types/documentProject';
import type {
  DocumentPageOrientation,
} from '../utils/documentPageOrientation';
import {
  DOCUMENT_FONT_FAMILY_IDS,
  DOCUMENT_STYLE_IDS,
  type DocumentDropCapSettings,
  type DocumentNamedStyleDefinition,
  type DocumentNamedStyleRegistry,
  type DocumentStyleId,
} from '../typography/documentTypography';

type DocumentSidebarProps = {
  page: DocumentPage;
  folios: DocumentFolioSettings;
  documentLanguage: string;
  styles: DocumentNamedStyleRegistry;
  paperColor: string;
  isOverflowing: boolean;
  collapsed: boolean;
  selectedOverlayId: string | null;
  onCollapsedChange: (collapsed: boolean) => void;
  onPresetChange: (preset: 'letter' | 'a4' | 'custom') => void;
  onOrientationChange: (orientation: DocumentPageOrientation) => void;
  onCustomSizeChange: (update: { widthIn?: number; heightIn?: number }) => void;
  onPaperColorChange: (value: string) => void;
  onFolioSettingsChange: (update: Partial<DocumentFolioSettings>) => void;
  onSuppressFolioChange: (suppressed: boolean) => void;
  onMarginChange: (side: keyof DocumentPage['margins'], value: number) => void;
  onColumnCountChange: (count: 1 | 2 | 3) => void;
  onColumnGapChange: (gapPx: number) => void;
  onDocumentLanguageChange: (language: string) => void;
  onPageLanguageChange: (language?: string) => void;
  onStyleChange: (
    styleId: DocumentStyleId,
    update: Partial<DocumentNamedStyleDefinition>
  ) => void;
  onDropCapChange: (update: Partial<DocumentDropCapSettings>) => void;
  onImportImages: (files: File[]) => void;
  onImportReference: (file: File) => void;
  onToggleReferenceVisibility: () => void;
  onReferenceAdjustModeChange: (enabled: boolean) => void;
  referenceAdjustMode: boolean;
  onReferenceChange: (
    update: Partial<NonNullable<DocumentPage['reference']>>
  ) => void;
  onResetReference: () => void;
  onSelectOverlay: (id: string) => void;
};

const numberValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const MARGIN_FIELDS: Array<{
  key: keyof DocumentPage['margins'];
  label: string;
}> = [
  { key: 'topIn', label: 'Top' },
  { key: 'bottomIn', label: 'Bottom' },
  { key: 'innerIn', label: 'Inner' },
  { key: 'outerIn', label: 'Outer' },
];

const STYLE_LABELS: Record<DocumentStyleId, string> = {
  'article-title': 'Article title',
  body: 'Body',
  'subsection-heading': 'Subsection heading',
  caption: 'Caption',
  quotation: 'Quotation / scripture',
  'author-signature': 'Author / signature',
};

const FONT_LABELS = {
  'historical-serif': 'Historical serif',
  'book-serif': 'Book serif',
  'classic-serif': 'Classic serif',
  'humanist-sans': 'Humanist sans',
  'system-sans': 'System sans',
} as const;

const PositionedPhotoList = ({
  overlays,
  selectedId,
  onSelect,
}: {
  overlays: DocumentOverlayImage[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => {
  if (overlays.length === 0) return null;
  return (
    <div className="document-sidebar__subgroup">
      <span className="document-field-label">Positioned photos</span>
      <div className="document-positioned-photo-list">
        {overlays.map((overlay, index) => (
          <button
            key={overlay.id}
            type="button"
            className={selectedId === overlay.id ? 'is-selected' : ''}
            aria-pressed={selectedId === overlay.id}
            onClick={() => onSelect(overlay.id)}
          >
            <span>Photo {index + 1}</span>
            <small>{overlay.placement === 'front' ? 'In front' : 'Behind text'}</small>
          </button>
        ))}
      </div>
    </div>
  );
};

export const DocumentSidebar: React.FC<DocumentSidebarProps> = (props) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const reference = props.page.reference;
  const [selectedStyleId, setSelectedStyleId] =
    useState<DocumentStyleId>('body');
  const selectedStyle = props.styles[selectedStyleId];

  if (props.collapsed) {
    return (
      <aside
        id="document-properties-sidebar"
        className="document-properties-sidebar is-collapsed"
        data-document-editor-ui="true"
        data-testid="document-properties-sidebar"
        data-collapsed="true"
        aria-label="Document properties"
        aria-expanded="false"
      >
        <button
          type="button"
          className="document-sidebar-expand"
          onClick={() => props.onCollapsedChange(false)}
          aria-label="Expand properties sidebar"
          aria-controls="document-properties-sidebar"
          aria-expanded="false"
        >
          <ChevronRight size={19} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      id="document-properties-sidebar"
      className="document-properties-sidebar"
      data-document-editor-ui="true"
      data-testid="document-properties-sidebar"
      data-collapsed="false"
      aria-label="Document properties"
      aria-expanded="true"
    >
      <div className="document-sidebar__heading">
        <div>
          <strong>Document settings</strong>
          <span>Page and layout</span>
        </div>
        <button
          type="button"
          onClick={() => props.onCollapsedChange(true)}
          aria-label="Collapse properties sidebar"
          aria-controls="document-properties-sidebar"
          aria-expanded="true"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="document-sidebar__scroll">
        <section className="document-sidebar-section" aria-labelledby="document-page-settings">
          <h2 id="document-page-settings">Page</h2>
          <label className="document-field">
            <span>Page size</span>
            <select
              aria-label="Page preset"
              data-testid="document-page-preset"
              value={props.page.size.presetId}
              onChange={(event) => props.onPresetChange(
                event.target.value as 'letter' | 'a4' | 'custom'
              )}
            >
              <option value="letter">Letter — 8.5 × 11 in</option>
              <option value="a4">A4 — 210 × 297 mm</option>
              <option value="custom">Custom dimensions</option>
            </select>
          </label>

          {props.page.size.presetId === 'custom' && (
            <div
              className="document-margin-grid"
              data-testid="document-custom-page-size"
            >
              <label className="document-field">
                <span>Width <small>inches</small></span>
                <input
                  aria-label="Custom page width in inches"
                  type="number"
                  min="1"
                  max="24"
                  step="0.05"
                  value={props.page.size.widthIn}
                  onChange={(event) => props.onCustomSizeChange({
                    widthIn: Math.min(
                      24,
                      Math.max(
                        1,
                        numberValue(
                          event.target.value,
                          props.page.size.widthIn
                        )
                      )
                    ),
                  })}
                />
              </label>
              <label className="document-field">
                <span>Height <small>inches</small></span>
                <input
                  aria-label="Custom page height in inches"
                  type="number"
                  min="1"
                  max="24"
                  step="0.05"
                  value={props.page.size.heightIn}
                  onChange={(event) => props.onCustomSizeChange({
                    heightIn: Math.min(
                      24,
                      Math.max(
                        1,
                        numberValue(
                          event.target.value,
                          props.page.size.heightIn
                        )
                      )
                    ),
                  })}
                />
              </label>
            </div>
          )}

          <div className="document-field">
            <span>Orientation</span>
            <div
              className="document-orientation-segments"
              role="group"
              aria-label="Page orientation"
              data-testid="document-page-orientation"
              data-value={props.page.size.orientation}
            >
              {(['portrait', 'landscape'] as const).map((orientation) => (
                <button
                  key={orientation}
                  type="button"
                  aria-label={
                    orientation === 'portrait'
                      ? 'Portrait orientation'
                      : 'Landscape orientation'
                  }
                  aria-pressed={props.page.size.orientation === orientation}
                  className={
                    props.page.size.orientation === orientation
                      ? 'is-selected'
                      : ''
                  }
                  onClick={() => props.onOrientationChange(orientation)}
                >
                  {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
                </button>
              ))}
            </div>
          </div>

          <label className="document-field document-paper-color-field">
            <span>
              Paper colour
              <output>{props.paperColor}</output>
            </span>
            <input
              aria-label="Paper colour"
              data-testid="document-paper-color"
              type="color"
              value={props.paperColor}
              onChange={(event) => props.onPaperColorChange(event.target.value)}
            />
          </label>

          <fieldset className="document-margin-fieldset">
            <legend>Margins <span>inches</span></legend>
            <div className="document-margin-grid">
              {MARGIN_FIELDS.map(({ key, label }) => (
                <label key={key} className="document-field">
                  <span>{label}</span>
                  <input
                    aria-label={`${label} margin in inches`}
                    type="number"
                    min="0"
                    max="3"
                    step="0.05"
                    value={props.page.margins[key]}
                    onChange={(event) => props.onMarginChange(
                      key,
                      Math.max(
                        0,
                        numberValue(event.target.value, props.page.margins[key])
                      )
                    )}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <label className="document-field">
            <span>Starting folio</span>
            <input
              aria-label="Starting folio number"
              data-testid="document-starting-folio"
              type="number"
              min="1"
              max="999999"
              step="1"
              value={props.folios.startingNumber}
              onChange={(event) => props.onFolioSettingsChange({
                startingNumber: numberValue(
                  event.target.value,
                  props.folios.startingNumber
                ),
              })}
            />
          </label>

          <button
            type="button"
            data-testid="document-show-folios"
            className={`document-toggle-row ${props.folios.visible ? 'is-selected' : ''}`}
            aria-pressed={props.folios.visible}
            onClick={() => props.onFolioSettingsChange({
              visible: !props.folios.visible,
            })}
          >
            <span>
              <strong>Show page numbers</strong>
              <small>Place folios at the outside bottom edge</small>
            </span>
            <span className="document-switch" aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="document-suppress-folio"
            className={`document-toggle-row ${props.page.suppressFolio ? 'is-selected' : ''}`}
            aria-pressed={props.page.suppressFolio}
            onClick={() => props.onSuppressFolioChange(
              !props.page.suppressFolio
            )}
          >
            <span>
              <strong>Hide number on this page</strong>
              <small>Keep numbering for the following pages</small>
            </span>
            <span className="document-switch" aria-hidden="true" />
          </button>
        </section>

        <section className="document-sidebar-section" aria-labelledby="document-layout-settings">
          <h2 id="document-layout-settings">Layout</h2>
          <div className="document-field">
            <span>Body columns</span>
            <div
              className="document-column-segments"
              role="group"
              aria-label="Body columns"
              data-testid="document-column-count"
              data-value={props.page.columnCount}
            >
              {([1, 2, 3] as const).map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-label={`${count} ${count === 1 ? 'column' : 'columns'}`}
                  aria-pressed={props.page.columnCount === count}
                  className={props.page.columnCount === count ? 'is-selected' : ''}
                  onClick={() => props.onColumnCountChange(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>

          <label className="document-field">
            <span>Column gap <small>px</small></span>
            <input
              aria-label="Column gap in pixels"
              data-testid="document-column-gap"
              type="number"
              min="0"
              max="96"
              value={props.page.columnGapPx}
              onChange={(event) => props.onColumnGapChange(
                Math.max(
                  0,
                  numberValue(event.target.value, props.page.columnGapPx)
                )
              )}
            />
          </label>

          <div
            className={`document-overflow-status ${props.isOverflowing ? 'is-warning' : ''}`}
            data-testid="document-sidebar-overflow-status"
            role="status"
          >
            <span aria-hidden="true" />
            {props.isOverflowing
              ? 'Content exceeds this page'
              : 'Content fits on this page'}
          </div>
        </section>

        <section
          className="document-sidebar-section"
          aria-labelledby="document-typography-settings"
        >
          <h2 id="document-typography-settings">Typography</h2>

          <label className="document-field">
            <span>Document language</span>
            <select
              aria-label="Document language"
              data-testid="document-language"
              value={props.documentLanguage}
              onChange={(event) => props.onDocumentLanguageChange(
                event.target.value
              )}
            >
              {!['en', 'de', 'fr', 'nl'].includes(
                props.documentLanguage
              ) && (
                <option value={props.documentLanguage}>
                  {props.documentLanguage}
                </option>
              )}
              <option value="en">English</option>
              <option value="de">German</option>
              <option value="fr">French</option>
              <option value="nl">Dutch</option>
            </select>
          </label>

          <label className="document-field">
            <span>This page language</span>
            <select
              aria-label="Page language"
              data-testid="document-page-language"
              value={props.page.language || ''}
              onChange={(event) => props.onPageLanguageChange(
                event.target.value || undefined
              )}
            >
              <option value="">Inherit document ({props.documentLanguage})</option>
              {props.page.language
                && !['en', 'de', 'fr', 'nl'].includes(
                  props.page.language
                ) && (
                  <option value={props.page.language}>
                    {props.page.language}
                  </option>
                )}
              <option value="en">English</option>
              <option value="de">German</option>
              <option value="fr">French</option>
              <option value="nl">Dutch</option>
            </select>
          </label>

          <label className="document-field">
            <span>Named style</span>
            <select
              aria-label="Named typography style"
              data-testid="document-named-style"
              value={selectedStyleId}
              onChange={(event) => setSelectedStyleId(
                event.target.value as DocumentStyleId
              )}
            >
              {DOCUMENT_STYLE_IDS.map((styleId) => (
                <option key={styleId} value={styleId}>
                  {STYLE_LABELS[styleId]}
                </option>
              ))}
            </select>
          </label>

          <label className="document-field">
            <span>Font family</span>
            <select
              aria-label="Named style font family"
              value={selectedStyle.fontFamilyId}
              onChange={(event) => props.onStyleChange(selectedStyleId, {
                fontFamilyId: event.target.value as
                  DocumentNamedStyleDefinition['fontFamilyId'],
              })}
            >
              {DOCUMENT_FONT_FAMILY_IDS.map((fontId) => (
                <option key={fontId} value={fontId}>
                  {FONT_LABELS[fontId]}
                </option>
              ))}
            </select>
          </label>

          <div className="document-margin-grid">
            <label className="document-field">
              <span>Size <small>px</small></span>
              <input
                aria-label="Named style font size"
                type="number"
                min="6"
                max="240"
                step="0.5"
                value={selectedStyle.fontSizePx}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  fontSizePx: numberValue(
                    event.target.value,
                    selectedStyle.fontSizePx
                  ),
                })}
              />
            </label>
            <label className="document-field">
              <span>Line height</span>
              <input
                aria-label="Named style line height"
                type="number"
                min="0.75"
                max="3"
                step="0.05"
                value={selectedStyle.lineHeight}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  lineHeight: numberValue(
                    event.target.value,
                    selectedStyle.lineHeight
                  ),
                })}
              />
            </label>
            <label className="document-field">
              <span>After <small>px</small></span>
              <input
                aria-label="Named style paragraph spacing"
                type="number"
                min="0"
                max="192"
                value={selectedStyle.paragraphSpacingPx}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  paragraphSpacingPx: numberValue(
                    event.target.value,
                    selectedStyle.paragraphSpacingPx
                  ),
                })}
              />
            </label>
            <label className="document-field">
              <span>Indent <small>px</small></span>
              <input
                aria-label="Named style first line indent"
                type="number"
                min="0"
                max="480"
                value={selectedStyle.firstLineIndentPx}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  firstLineIndentPx: numberValue(
                    event.target.value,
                    selectedStyle.firstLineIndentPx
                  ),
                })}
              />
            </label>
            <label className="document-field">
              <span>Tracking <small>em</small></span>
              <input
                aria-label="Named style tracking"
                type="number"
                min="-0.15"
                max="0.5"
                step="0.01"
                value={selectedStyle.trackingEm}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  trackingEm: numberValue(
                    event.target.value,
                    selectedStyle.trackingEm
                  ),
                })}
              />
            </label>
            <label className="document-field">
              <span>Weight</span>
              <select
                aria-label="Named style font weight"
                value={selectedStyle.fontWeight}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  fontWeight: Number(event.target.value) as
                    DocumentNamedStyleDefinition['fontWeight'],
                })}
              >
                <option value="400">Regular</option>
                <option value="500">Medium</option>
                <option value="600">Semibold</option>
                <option value="700">Bold</option>
              </select>
            </label>
          </div>

          <label className="document-field document-paper-color-field">
            <span>Text colour <output>{selectedStyle.color}</output></span>
            <input
              aria-label="Named style text colour"
              type="color"
              value={selectedStyle.color}
              onChange={(event) => props.onStyleChange(selectedStyleId, {
                color: event.target.value,
              })}
            />
          </label>

          <div className="document-margin-grid">
            <label className="document-field">
              <span>Alignment</span>
              <select
                aria-label="Named style alignment"
                value={selectedStyle.alignment}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  alignment: event.target.value as
                    DocumentNamedStyleDefinition['alignment'],
                })}
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
                <option value="justify">Justify</option>
              </select>
            </label>
            <label className="document-field">
              <span>Hyphenation</span>
              <select
                aria-label="Named style hyphenation"
                value={selectedStyle.hyphenation}
                onChange={(event) => props.onStyleChange(selectedStyleId, {
                  hyphenation: event.target.value as
                    DocumentNamedStyleDefinition['hyphenation'],
                })}
              >
                <option value="auto">Automatic</option>
                <option value="manual">Manual only</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>

          <button
            type="button"
            data-testid="document-style-italic"
            className={`document-toggle-row ${
              selectedStyle.italic ? 'is-selected' : ''
            }`}
            aria-pressed={selectedStyle.italic}
            onClick={() => props.onStyleChange(selectedStyleId, {
              italic: !selectedStyle.italic,
            })}
          >
            <span>
              <strong>Italic named style</strong>
              <small>Applies wherever this semantic role is used</small>
            </span>
            <span className="document-switch" aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="document-drop-cap-toggle"
            className={`document-toggle-row ${
              props.page.dropCap.enabled ? 'is-selected' : ''
            }`}
            aria-pressed={props.page.dropCap.enabled}
            onClick={() => props.onDropCapChange({
              enabled: !props.page.dropCap.enabled,
            })}
          >
            <span>
              <strong>Drop cap on this page</strong>
              <small>Enlarge the first body letter</small>
            </span>
            <span className="document-switch" aria-hidden="true" />
          </button>

          {props.page.dropCap.enabled && (
            <div
              className="document-margin-grid"
              data-testid="document-drop-cap-settings"
            >
              <label className="document-field">
                <span>Size <small>em</small></span>
                <input
                  aria-label="Drop cap size"
                  type="number"
                  min="1"
                  max="12"
                  step="0.05"
                  value={props.page.dropCap.sizeEm}
                  onChange={(event) => props.onDropCapChange({
                    sizeEm: numberValue(
                      event.target.value,
                      props.page.dropCap.sizeEm
                    ),
                  })}
                />
              </label>
              <label className="document-field">
                <span>Lines</span>
                <input
                  aria-label="Drop cap line span"
                  type="number"
                  min="1"
                  max="10"
                  step="1"
                  value={props.page.dropCap.lineSpan}
                  onChange={(event) => props.onDropCapChange({
                    lineSpan: numberValue(
                      event.target.value,
                      props.page.dropCap.lineSpan
                    ),
                  })}
                />
              </label>
              <label className="document-field">
                <span>Gap <small>px</small></span>
                <input
                  aria-label="Drop cap spacing"
                  type="number"
                  min="0"
                  max="96"
                  value={props.page.dropCap.spacingPx}
                  onChange={(event) => props.onDropCapChange({
                    spacingPx: numberValue(
                      event.target.value,
                      props.page.dropCap.spacingPx
                    ),
                  })}
                />
              </label>
              <label className="document-field">
                <span>Font</span>
                <select
                  aria-label="Drop cap font family"
                  value={props.page.dropCap.fontFamilyId}
                  onChange={(event) => props.onDropCapChange({
                    fontFamilyId: event.target.value as
                      DocumentDropCapSettings['fontFamilyId'],
                  })}
                >
                  <option value="inherit">Inherit body</option>
                  {DOCUMENT_FONT_FAMILY_IDS.map((fontId) => (
                    <option key={fontId} value={fontId}>
                      {FONT_LABELS[fontId]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="document-field">
                <span>Colour</span>
                <select
                  aria-label="Drop cap colour mode"
                  value={
                    props.page.dropCap.color === 'inherit'
                      ? 'inherit'
                      : 'custom'
                  }
                  onChange={(event) => props.onDropCapChange({
                    color: event.target.value === 'inherit'
                      ? 'inherit'
                      : props.styles.body.color,
                  })}
                >
                  <option value="inherit">Inherit body</option>
                  <option value="custom">Custom</option>
                </select>
              </label>
              {props.page.dropCap.color !== 'inherit' && (
                <label className="document-field document-paper-color-field">
                  <span>Drop cap colour</span>
                  <input
                    aria-label="Drop cap custom colour"
                    type="color"
                    value={props.page.dropCap.color}
                    onChange={(event) => props.onDropCapChange({
                      color: event.target.value,
                    })}
                  />
                </label>
              )}
            </div>
          )}
        </section>

        <section className="document-sidebar-section" aria-labelledby="document-insert-settings">
          <h2 id="document-insert-settings">Document</h2>
          <button
            type="button"
            className="document-sidebar-action document-sidebar-action--primary"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus size={18} aria-hidden="true" />
            <span>
              <strong>Add photo</strong>
              <small>Choose an image, or paste into the page</small>
            </span>
          </button>
          <input
            ref={imageInputRef}
            className="document-visually-hidden"
            data-testid="document-image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length) props.onImportImages(files);
              event.target.value = '';
            }}
          />
          <PositionedPhotoList
            overlays={props.page.overlayObjects}
            selectedId={props.selectedOverlayId}
            onSelect={props.onSelectOverlay}
          />
        </section>

        <section className="document-sidebar-section" aria-labelledby="document-reference-settings">
          <div className="document-sidebar-section__title">
            <h2 id="document-reference-settings">Reference scan</h2>
            {reference && (
              <span className="document-locked-badge">
                <Lock size={12} aria-hidden="true" />
                Locked
              </span>
            )}
          </div>
          <p className="document-section-help">
            Align a scan or first PDF page behind your reconstruction. It is never exported.
          </p>
          <button
            type="button"
            className="document-sidebar-action"
            onClick={() => referenceInputRef.current?.click()}
          >
            <FileImage size={18} aria-hidden="true" />
            <span>
              <strong>{reference ? 'Replace reference scan' : 'Add reference scan'}</strong>
              <small>Image or first page of a PDF</small>
            </span>
          </button>
          <input
            ref={referenceInputRef}
            className="document-visually-hidden"
            data-testid="document-reference-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp,application/pdf,.pdf"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onImportReference(file);
              event.target.value = '';
            }}
          />

          {reference && (
            <div className="document-reference-controls" data-testid="document-reference-controls">
              <div className="document-reference-actions">
                <button
                  type="button"
                  data-testid="document-reference-visibility"
                  aria-pressed={reference.visible}
                  onClick={props.onToggleReferenceVisibility}
                >
                  {reference.visible
                    ? <EyeOff size={16} aria-hidden="true" />
                    : <Eye size={16} aria-hidden="true" />}
                  {reference.visible ? 'Hide reference' : 'Show reference'}
                </button>
                <button
                  type="button"
                  className={props.referenceAdjustMode ? 'is-selected' : ''}
                  aria-pressed={props.referenceAdjustMode}
                  onClick={() => props.onReferenceAdjustModeChange(
                    !props.referenceAdjustMode
                  )}
                >
                  {props.referenceAdjustMode ? 'Finish adjusting' : 'Adjust reference'}
                </button>
              </div>

              <label className="document-field">
                <span>Opacity <output>{Math.round(reference.opacity * 100)}%</output></span>
                <input
                  aria-label="Reference opacity"
                  data-testid="document-reference-opacity"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={reference.opacity}
                  onChange={(event) => props.onReferenceChange({
                    opacity: numberValue(event.target.value, 0.35),
                  })}
                />
              </label>

              <label className="document-field">
                <span>Fit</span>
                <select
                  aria-label="Reference fit"
                  value={reference.fit}
                  onChange={(event) => props.onReferenceChange({
                    fit: event.target.value as 'contain' | 'cover' | 'stretch',
                  })}
                >
                  <option value="contain">Contain</option>
                  <option value="cover">Cover</option>
                  <option value="stretch">Stretch</option>
                </select>
              </label>

              <div className="document-reference-number-grid">
                <label className="document-field">
                  <span>Scale</span>
                  <input
                    aria-label="Reference scale"
                    type="number"
                    min="0.05"
                    max="10"
                    step="0.05"
                    value={reference.scale}
                    onChange={(event) => props.onReferenceChange({
                      scale: Math.max(
                        0.05,
                        numberValue(event.target.value, reference.scale)
                      ),
                    })}
                  />
                </label>
                <label className="document-field">
                  <span>X offset</span>
                  <input
                    aria-label="Reference X offset"
                    type="number"
                    step="1"
                    value={Math.round(reference.offsetXPx)}
                    onChange={(event) => props.onReferenceChange({
                      offsetXPx: numberValue(event.target.value, reference.offsetXPx),
                    })}
                  />
                </label>
                <label className="document-field">
                  <span>Y offset</span>
                  <input
                    aria-label="Reference Y offset"
                    type="number"
                    step="1"
                    value={Math.round(reference.offsetYPx)}
                    onChange={(event) => props.onReferenceChange({
                      offsetYPx: numberValue(event.target.value, reference.offsetYPx),
                    })}
                  />
                </label>
              </div>

              <button
                type="button"
                className="document-reset-button"
                onClick={props.onResetReference}
              >
                <RotateCcw size={15} aria-hidden="true" />
                Reset alignment
              </button>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
