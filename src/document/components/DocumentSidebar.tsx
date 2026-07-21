import React, { useRef } from 'react';
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
  DocumentOverlayImage,
  DocumentPage,
} from '../types/documentProject';
import type {
  DocumentPageOrientation,
} from '../utils/documentPageOrientation';

type DocumentSidebarProps = {
  page: DocumentPage;
  isOverflowing: boolean;
  collapsed: boolean;
  selectedOverlayId: string | null;
  onCollapsedChange: (collapsed: boolean) => void;
  onPresetChange: (preset: 'letter' | 'a4') => void;
  onOrientationChange: (orientation: DocumentPageOrientation) => void;
  onMarginChange: (side: keyof DocumentPage['margins'], value: number) => void;
  onColumnCountChange: (count: 1 | 2 | 3) => void;
  onColumnGapChange: (gapPx: number) => void;
  onTitleFontSizeChange: (sizePx: number) => void;
  onToggleDropCap: () => void;
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
  { key: 'rightIn', label: 'Right' },
  { key: 'bottomIn', label: 'Bottom' },
  { key: 'leftIn', label: 'Left' },
];

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
              value={props.page.size.presetId === 'a4' ? 'a4' : 'letter'}
              onChange={(event) => props.onPresetChange(
                event.target.value as 'letter' | 'a4'
              )}
            >
              <option value="letter">Letter — 8.5 × 11 in</option>
              <option value="a4">A4 — 210 × 297 mm</option>
            </select>
          </label>

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

          <label className="document-field">
            <span>Title size <small>px</small></span>
            <input
              aria-label="Title font size"
              type="number"
              min="12"
              max="120"
              value={props.page.titleFontSizePx}
              onChange={(event) => props.onTitleFontSizeChange(
                Math.max(
                  12,
                  numberValue(event.target.value, props.page.titleFontSizePx)
                )
              )}
            />
          </label>

          <button
            type="button"
            data-testid="document-drop-cap-toggle"
            className={`document-toggle-row ${props.page.dropCap ? 'is-selected' : ''}`}
            aria-pressed={props.page.dropCap}
            onClick={props.onToggleDropCap}
          >
            <span>
              <strong>Drop cap</strong>
              <small>Enlarge the first body letter</small>
            </span>
            <span className="document-switch" aria-hidden="true" />
          </button>

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
