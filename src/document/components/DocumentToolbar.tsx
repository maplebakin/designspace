import React, { useRef } from 'react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  ImagePlus,
  Italic,
  Redo2,
  RotateCcw,
  Trash2,
  Underline,
  Undo2,
  Upload,
} from 'lucide-react';
import type {
  DocumentCaptionAlignment,
  DocumentCaptionItalic,
  DocumentCaptionSpacing,
  DocumentFlowImageWrap,
  DocumentImageGroupKind,
  DocumentImageCropMode,
  DocumentOverlayPlacement,
  DocumentPage,
} from '../types/documentProject';
import {
  MAX_DOCUMENT_IMAGE_GROUP_GAP_PX,
  normalizeDocumentImageGroupGapPx,
} from '../model/documentImageGroups';
import {
  DOCUMENT_FONT_SIZES_PT,
} from '../extensions/DocumentTextStyleExtension';
import type {
  DocumentBlockStyleId,
} from '../extensions/DocumentBlockStyleExtension';
import type {
  DocumentFlowControl,
} from '../extensions/DocumentFlowControlExtension';
import { CommittedInput, ControlSlider } from '../../editor/components/Tooltip';

export type DocumentImageInspectorValue = {
  id: string;
  kind: 'flow' | 'overlay';
  widthPx: number;
  heightPx: number;
  xPx?: number;
  yPx?: number;
  verticalAnchor?: 'flow' | 'page-position';
  horizontalPlacement?: 'left' | 'center' | 'right' | 'custom';
  xOffsetPx?: number;
  wrap: DocumentFlowImageWrap | DocumentOverlayPlacement;
  wrapPaddingPx?: number;
  verticalSpacingPx?: number;
  wrapPaddingTopPx?: number;
  wrapPaddingRightPx?: number;
  wrapPaddingBottomPx?: number;
  wrapPaddingLeftPx?: number;
  spanCount?: 1 | 2 | 3;
  spanStartColumn?: 1 | 2 | 3;
  caption: string;
  captionAlignment: DocumentCaptionAlignment;
  captionItalic: DocumentCaptionItalic;
  captionSpacingPx: DocumentCaptionSpacing;
  altText: string;
  naturalWidth?: number;
  naturalHeight?: number;
  cropMode?: DocumentImageCropMode;
  cropFocalX?: number;
  cropFocalY?: number;
  canMoveEarlier?: boolean;
  canMoveLater?: boolean;
};

export type DocumentImageGroupInspectorValue = {
  id: string;
  kind: DocumentImageGroupKind;
  childImageIds: readonly string[];
  gapPx: number;
  sharedWidth: boolean;
};

export type DocumentImageLayoutMode =
  | Exclude<DocumentFlowImageWrap, 'span-columns'>
  | DocumentOverlayPlacement
  | 'span-2'
  | 'span-3';

export type DocumentTextFormatState = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  alignment: 'left' | 'center' | 'right' | 'justify';
  fontSizePt: number | 'mixed';
  blockStyleId: DocumentBlockStyleId | 'mixed';
  columnBreakBefore?: boolean;
  keepWithNext?: boolean;
  keepLinesTogether?: boolean;
};

type DocumentToolbarProps = {
  page: DocumentPage;
  activeTextRegion: 'title' | 'body';
  selectedImage?: DocumentImageInspectorValue | null;
  selectedImageIds?: readonly string[];
  selectedImageGroup?: DocumentImageGroupInspectorValue | null;
  referenceAdjustMode: boolean;
  textFormatState: DocumentTextFormatState;
  onFormat: (
    command:
      | 'bold'
      | 'italic'
      | 'underline'
      | 'undo'
      | 'redo'
      | 'align-left'
      | 'align-center'
      | 'align-right'
      | 'align-justify'
  ) => void;
  onFontSizeChange: (fontSizePt: number) => void;
  onBlockStyleChange: (styleId: DocumentBlockStyleId) => void;
  onFlowControl?: (control: DocumentFlowControl) => void;
  onImportImages: (files: File[]) => void;
  onReferenceAdjustModeChange: (enabled: boolean) => void;
  onReferenceChange: (
    update: Partial<NonNullable<DocumentPage['reference']>>
  ) => void;
  onReferenceCommit?: (field: string, initialValue: number) => void;
  onResetReference: () => void;
  onSelectedImageChange: (update: Partial<DocumentImageInspectorValue>) => void;
  onSelectedImageCommit?: (field: string, initialValue: string) => void;
  onSelectedImageLayoutChange: (
    layout: DocumentImageLayoutMode
  ) => void;
  onSelectedImageSpanStartChange: (startColumn: 1 | 2) => void;
  onMoveSelectedImage: (direction: 'earlier' | 'later') => void;
  onReplaceSelectedImage: (file: File) => void;
  onDeleteSelectedImage: () => void;
  onResetSelectedImageSize: () => void;
  onArrangeSelectedImages?: (kind: DocumentImageGroupInspectorValue['kind']) => void;
  onSelectedImageGroupChange?: (
    update: Partial<Pick<
      DocumentImageGroupInspectorValue,
      'kind' | 'gapPx' | 'sharedWidth'
    >>
  ) => void;
  onSelectedImageGroupCommit?: (field: string, initialValue: number) => void;
  onUngroupSelectedImages?: () => void;
  onAlignSelectedImages?: (
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => void;
  onDistributeSelectedImages?: (axis: 'horizontal' | 'vertical') => void;
  onResetSelectedImageCrop?: () => void;
};

const numericValue = (value: string, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const FormatButton = ({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    className={`document-context-icon-button ${active ? 'is-selected' : ''}`}
    aria-label={label}
    aria-pressed={active}
    onClick={onClick}
  >
    {children}
  </button>
);

const DocumentImageGroupControls = ({
  selectedImageIds,
  selectedImageGroup,
  onArrangeSelectedImages,
  onSelectedImageGroupChange,
  onSelectedImageGroupCommit,
  onUngroupSelectedImages,
  onAlignSelectedImages,
  onDistributeSelectedImages,
}: {
  selectedImageIds: readonly string[];
  selectedImageGroup?: DocumentImageGroupInspectorValue | null;
  onArrangeSelectedImages?: (
    kind: DocumentImageGroupInspectorValue['kind']
  ) => void;
  onSelectedImageGroupChange?: (
    update: Partial<Pick<
      DocumentImageGroupInspectorValue,
      'kind' | 'gapPx' | 'sharedWidth'
    >>
  ) => void;
  onSelectedImageGroupCommit?: (field: string, initialValue: number) => void;
  onUngroupSelectedImages?: () => void;
  onAlignSelectedImages?: (
    alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ) => void;
  onDistributeSelectedImages?: (axis: 'horizontal' | 'vertical') => void;
}) => {
  const selectedCount = selectedImageIds.length;
  const groupCount = selectedImageGroup?.childImageIds.length ?? 0;
  const count = Math.max(selectedCount, groupCount);

  if (count < 2) {
    return null;
  }

  const arrange = (kind: DocumentImageGroupInspectorValue['kind']) => {
    if (selectedImageGroup) {
      onSelectedImageGroupChange?.({ kind });
      return;
    }
    onArrangeSelectedImages?.(kind);
  };

  return (
    <div
      className="document-image-group-controls"
      data-testid="document-image-group-selection"
      data-image-count={count}
      data-group-id={selectedImageGroup?.id}
    >
      <div className="document-context-heading">
        <span>
          {selectedImageGroup
            ? `${selectedImageGroup.kind === 'row' ? 'Row' : 'Stack'} group`
            : 'Multiple photos'}
        </span>
        <strong>{count} selected</strong>
      </div>
      <div
        className="document-context-button-group"
        aria-label="Image group arrangement"
      >
        <button
          type="button"
          className={`document-context-button document-context-button--quiet ${
            selectedImageGroup?.kind === 'row' ? 'is-selected' : ''
          }`}
          aria-pressed={selectedImageGroup?.kind === 'row'}
          data-testid="document-image-group-row"
          disabled={
            selectedImageGroup
              ? !onSelectedImageGroupChange
              : !onArrangeSelectedImages
          }
          onClick={() => arrange('row')}
        >
          Arrange row
        </button>
        <button
          type="button"
          className={`document-context-button document-context-button--quiet ${
            selectedImageGroup?.kind === 'stack' ? 'is-selected' : ''
          }`}
          aria-pressed={selectedImageGroup?.kind === 'stack'}
          data-testid="document-image-group-stack"
          disabled={
            selectedImageGroup
              ? !onSelectedImageGroupChange
              : !onArrangeSelectedImages
          }
          onClick={() => arrange('stack')}
        >
          Arrange stack
        </button>
      </div>
      {selectedImageGroup && (
        <>
          <label className="document-context-field">
            <span>Group gap</span>
            <CommittedInput
              aria-label="Image group gap"
              data-testid="document-image-group-gap"
              type="number"
              min="0"
              max={MAX_DOCUMENT_IMAGE_GROUP_GAP_PX}
              value={Math.round(selectedImageGroup.gapPx)}
              onChange={(event) => onSelectedImageGroupChange?.({
                gapPx: normalizeDocumentImageGroupGapPx(
                  event.target.value,
                  selectedImageGroup.gapPx
                ),
              })}
              onCommit={(_value, initialValue) => onSelectedImageGroupCommit?.(
                'gapPx',
                numericValue(initialValue, selectedImageGroup.gapPx)
              )}
            />
          </label>
          {selectedImageGroup.kind === 'stack' && (
            <label className="document-context-field">
              <span>Shared width</span>
              <input
                aria-label="Use shared image width"
                data-testid="document-image-group-shared-width"
                type="checkbox"
                checked={selectedImageGroup.sharedWidth}
                onChange={(event) => onSelectedImageGroupChange?.({
                  sharedWidth: event.target.checked,
                })}
              />
            </label>
          )}
          <button
            type="button"
            className="document-context-button document-context-button--quiet"
            data-testid="document-image-group-ungroup"
            disabled={!onUngroupSelectedImages}
            onClick={onUngroupSelectedImages}
          >
            Ungroup
          </button>
        </>
      )}
      <div
        className="document-context-button-group"
        aria-label="Image alignment"
      >
        {([
          ['left', 'Align left'],
          ['center', 'Align centre'],
          ['right', 'Align right'],
          ['top', 'Align top'],
          ['middle', 'Align middle'],
          ['bottom', 'Align bottom'],
        ] as const).map(([alignment, label]) => (
          <button
            key={alignment}
            type="button"
            className="document-context-button document-context-button--quiet"
            data-testid={`document-image-align-${alignment}`}
            disabled={!onAlignSelectedImages}
            onClick={() => onAlignSelectedImages?.(alignment)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="document-context-button document-context-button--quiet"
          data-testid="document-image-distribute-horizontal"
          disabled={count < 3 || Boolean(selectedImageGroup) || !onDistributeSelectedImages}
          onClick={() => onDistributeSelectedImages?.('horizontal')}
        >
          Distribute horizontally
        </button>
        <button
          type="button"
          className="document-context-button document-context-button--quiet"
          data-testid="document-image-distribute-vertical"
          disabled={count < 3 || Boolean(selectedImageGroup) || !onDistributeSelectedImages}
          onClick={() => onDistributeSelectedImages?.('vertical')}
        >
          Distribute vertically
        </button>
      </div>
      <div className="document-context-divider" aria-hidden="true" />
    </div>
  );
};

export const DocumentToolbar: React.FC<DocumentToolbarProps> = (props) => {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const reference = props.page.reference;
  const context = props.referenceAdjustMode
    ? 'reference'
    : props.selectedImage
      || (props.selectedImageIds?.length ?? 0) > 1
      || props.selectedImageGroup
      ? 'image'
      : props.activeTextRegion;
  const fontSizeValue = props.textFormatState.fontSizePt;
  const hasPresetFontSize =
    fontSizeValue !== 'mixed'
    && DOCUMENT_FONT_SIZES_PT.some((size) => size === fontSizeValue);
  const selectedLayout: DocumentImageLayoutMode =
    props.selectedImage?.wrap === 'span-columns'
      ? `span-${props.selectedImage.spanCount === 3 ? 3 : 2}`
      : props.selectedImage?.wrap ?? 'float-left';

  return (
    <div
      className={`document-context-toolbar document-context-toolbar--${context}`}
      data-document-editor-ui="true"
      data-testid="document-context-toolbar"
      data-context={context}
    >
      {props.referenceAdjustMode && reference ? (
        <div className="document-context-toolbar__content">
          <div className="document-context-heading">
            <span>Reference scan</span>
            <strong>Adjusting alignment</strong>
          </div>
          <label className="document-context-field document-context-field--range">
            <span>Opacity</span>
            <ControlSlider
              aria-label="Adjusting opacity"
              min={0}
              max={1}
              step={0.05}
              value={reference.opacity}
              onChange={(value) => props.onReferenceChange({ opacity: value })}
              onCommit={(_value, initialValue) => props.onReferenceCommit?.(
                'opacity',
                initialValue
              )}
            />
            <output>{Math.round(reference.opacity * 100)}%</output>
          </label>
          <label className="document-context-field">
            <span>Scale</span>
            <CommittedInput
              aria-label="Adjusting scale"
              type="number"
              min="0.05"
              max="10"
              step="0.05"
              value={reference.scale}
              onChange={(event) => props.onReferenceChange({
                scale: Math.max(
                  0.05,
                  numericValue(event.target.value, reference.scale)
                ),
              })}
              onCommit={(_value, initialValue) => props.onReferenceCommit?.(
                'scale',
                numericValue(initialValue, reference.scale)
              )}
            />
          </label>
          <label className="document-context-field">
            <span>X</span>
            <CommittedInput
              aria-label="Adjusting X position"
              type="number"
              value={Math.round(reference.offsetXPx)}
              onChange={(event) => props.onReferenceChange({
                offsetXPx: numericValue(event.target.value, reference.offsetXPx),
              })}
              onCommit={(_value, initialValue) => props.onReferenceCommit?.(
                'offsetXPx',
                numericValue(initialValue, reference.offsetXPx)
              )}
            />
          </label>
          <label className="document-context-field">
            <span>Y</span>
            <CommittedInput
              aria-label="Adjusting Y position"
              type="number"
              value={Math.round(reference.offsetYPx)}
              onChange={(event) => props.onReferenceChange({
                offsetYPx: numericValue(event.target.value, reference.offsetYPx),
              })}
              onCommit={(_value, initialValue) => props.onReferenceCommit?.(
                'offsetYPx',
                numericValue(initialValue, reference.offsetYPx)
              )}
            />
          </label>
          <button
            type="button"
            className="document-context-button document-context-button--quiet"
            onClick={props.onResetReference}
          >
            <RotateCcw size={15} aria-hidden="true" />
            Reset
          </button>
          <span className="document-context-spacer" />
          <button
            type="button"
            className="document-context-button document-context-button--primary"
            onClick={() => props.onReferenceAdjustModeChange(false)}
          >
            Finish adjusting
          </button>
        </div>
      ) : props.selectedImage ? (
        <div
          className="document-context-toolbar__content document-image-inspector"
          data-testid="document-image-inspector"
          data-selected-image-id={props.selectedImage.id}
        >
          <DocumentImageGroupControls
            selectedImageIds={props.selectedImageIds ?? [props.selectedImage.id]}
            selectedImageGroup={props.selectedImageGroup}
            onArrangeSelectedImages={props.onArrangeSelectedImages}
            onSelectedImageGroupChange={props.onSelectedImageGroupChange}
            onSelectedImageGroupCommit={props.onSelectedImageGroupCommit}
            onUngroupSelectedImages={props.onUngroupSelectedImages}
            onAlignSelectedImages={props.onAlignSelectedImages}
            onDistributeSelectedImages={props.onDistributeSelectedImages}
          />
          <div className="document-context-heading">
            <span>{props.selectedImage.kind === 'flow' ? 'Flow photo' : 'Positioned photo'}</span>
            <strong>
              {props.selectedImage.kind === 'flow'
                ? 'Wrap and caption'
                : 'Placement and size'}
            </strong>
          </div>
          <label className="document-context-field">
            <span>Layout mode</span>
            <select
              aria-label="Image layout mode"
              data-testid="document-image-wrap"
              value={selectedLayout}
              onChange={(event) => props.onSelectedImageLayoutChange(
                event.target.value as DocumentImageLayoutMode
              )}
            >
              <option value="inline">Inline</option>
              <option value="float-left">Float left</option>
              <option value="float-right">Float right</option>
              <option value="top-bottom">Single column (top and bottom)</option>
              {props.page.columnCount >= 2 && (
                <option value="span-2">
                  {props.page.columnCount === 2
                    ? 'Span both columns'
                    : 'Span 2 columns'}
                </option>
              )}
              {props.page.columnCount === 3 && (
                <option value="span-3">Span all 3 columns</option>
              )}
              <option value="front">In front of text</option>
              <option value="behind">Behind text</option>
            </select>
          </label>
          {props.selectedImage.kind === 'flow'
            && props.selectedImage.wrap === 'span-columns'
            && props.selectedImage.spanCount === 2
            && props.page.columnCount === 3 && (
              <label className="document-context-field">
                <span>Starting column</span>
                <select
                  aria-label="Spanning image starting column"
                  data-testid="document-image-span-start"
                  value={props.selectedImage.spanStartColumn === 2 ? '2' : '1'}
                  onChange={(event) =>
                    props.onSelectedImageSpanStartChange(
                      event.target.value === '2' ? 2 : 1
                    )}
                >
                  <option value="1">Columns 1–2</option>
                  <option value="2">Columns 2–3</option>
                </select>
              </label>
            )}
          {props.selectedImage.kind === 'flow'
            && props.selectedImage.wrap === 'span-columns' && (
              <>
                <label className="document-context-field">
                  <span>Horizontal placement</span>
                  <select
                    aria-label="Image horizontal placement"
                    data-testid="document-image-horizontal-placement"
                    value={props.selectedImage.horizontalPlacement || 'left'}
                    onChange={(event) => props.onSelectedImageChange({
                      horizontalPlacement: event.target.value as
                        NonNullable<
                          DocumentImageInspectorValue['horizontalPlacement']
                        >,
                    })}
                  >
                    <option value="left">Left</option>
                    <option value="center">Centre</option>
                    <option value="right">Right</option>
                    <option value="custom">Custom</option>
                  </select>
                </label>
                {props.selectedImage.horizontalPlacement === 'custom' && (
                  <label className="document-context-field">
                    <span>Horizontal offset</span>
                    <CommittedInput
                      aria-label="Image horizontal offset"
                      data-testid="document-image-x-offset"
                      type="number"
                      min="0"
                      value={Math.round(props.selectedImage.xOffsetPx || 0)}
                      onChange={(event) => props.onSelectedImageChange({
                        xOffsetPx: Math.max(
                          0,
                          numericValue(
                            event.target.value,
                            props.selectedImage!.xOffsetPx || 0
                          )
                        ),
                      })}
                      onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                        'xOffsetPx',
                        initialValue
                      )}
                    />
                  </label>
                )}
                <label className="document-context-field">
                  <span>Vertical placement</span>
                  <select
                    aria-label="Image vertical placement"
                    data-testid="document-image-vertical-anchor"
                    value={props.selectedImage.verticalAnchor || 'flow'}
                    onChange={(event) => props.onSelectedImageChange({
                      verticalAnchor:
                        event.target.value === 'page-position'
                          ? 'page-position'
                          : 'flow',
                    })}
                  >
                    <option value="flow">Follow article text</option>
                    <option value="page-position">Fixed position on page</option>
                  </select>
                </label>
                {props.selectedImage.verticalAnchor === 'page-position' && (
                  <label className="document-context-field">
                    <span>Position from body top</span>
                    <CommittedInput
                      aria-label="Image Y position"
                      data-testid="document-image-y-position"
                      type="number"
                      min="0"
                      value={Math.round(props.selectedImage.yPx || 0)}
                      onChange={(event) => props.onSelectedImageChange({
                        yPx: Math.max(
                          0,
                          numericValue(
                            event.target.value,
                            props.selectedImage!.yPx || 0
                          )
                        ),
                      })}
                      onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                        'yPx',
                        initialValue
                      )}
                    />
                  </label>
                )}
              </>
            )}
          {props.selectedImage.kind === 'flow'
            && props.selectedImage.wrap === 'span-columns'
            && props.selectedImage.verticalAnchor !== 'page-position' && (
              <div
                className="document-context-button-group"
                aria-label="Spanning image position"
              >
                <button
                  type="button"
                  className="document-context-button document-context-button--quiet"
                  data-testid="document-image-move-earlier"
                  disabled={!props.selectedImage.canMoveEarlier}
                  onClick={() => props.onMoveSelectedImage('earlier')}
                >
                  <ArrowUp size={15} aria-hidden="true" />
                  Move earlier
                </button>
                <button
                  type="button"
                  className="document-context-button document-context-button--quiet"
                  data-testid="document-image-move-later"
                  disabled={!props.selectedImage.canMoveLater}
                  onClick={() => props.onMoveSelectedImage('later')}
                >
                  <ArrowDown size={15} aria-hidden="true" />
                  Move later
                </button>
              </div>
            )}
          <label className="document-context-field">
            <span>Width</span>
            <CommittedInput
              aria-label="Image width"
              data-testid="document-image-width"
              type="number"
              min="48"
              max={props.selectedImage.wrap === 'span-columns' ? 1600 : 720}
              value={Math.round(props.selectedImage.widthPx)}
              onChange={(event) => props.onSelectedImageChange({
                widthPx: Math.max(
                  48,
                  numericValue(
                    event.target.value,
                    props.selectedImage!.widthPx
                  )
                ),
              })}
              onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                'widthPx',
                initialValue
              )}
            />
          </label>
          <label className="document-context-field">
            <span>Height</span>
            <CommittedInput
              aria-label="Image height"
              data-testid="document-image-height"
              type="number"
              min="1"
              max="2000"
              value={Math.round(props.selectedImage.heightPx)}
              onChange={(event) => props.onSelectedImageChange({
                heightPx: Math.max(
                  1,
                  numericValue(
                    event.target.value,
                    props.selectedImage!.heightPx
                  )
                ),
              })}
              onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                'heightPx',
                initialValue
              )}
            />
          </label>
          <label className="document-context-field">
            <span>Frame</span>
            <select
              aria-label="Image frame mode"
              data-testid="document-image-crop-mode"
              value={props.selectedImage.cropMode || 'fit'}
              onChange={(event) => props.onSelectedImageChange({
                cropMode: event.target.value as DocumentImageCropMode,
              })}
            >
              <option value="fit">Fit entire photo</option>
              <option value="fill">Fill frame / crop</option>
            </select>
          </label>
          {props.selectedImage.cropMode === 'fill' && (
            <>
              <label className="document-context-field document-context-field--range">
                <span>Focal X</span>
                <ControlSlider
                  aria-label="Image crop focal X"
                  data-testid="document-image-crop-focal-x"
                  min={0}
                  max={1}
                  step={0.01}
                  value={props.selectedImage.cropFocalX ?? 0.5}
                  onChange={(value) => props.onSelectedImageChange({ cropFocalX: value })}
                  onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                    'cropFocalX',
                    String(initialValue)
                  )}
                />
                <output>{Math.round((props.selectedImage.cropFocalX ?? 0.5) * 100)}%</output>
              </label>
              <label className="document-context-field document-context-field--range">
                <span>Focal Y</span>
                <ControlSlider
                  aria-label="Image crop focal Y"
                  data-testid="document-image-crop-focal-y"
                  min={0}
                  max={1}
                  step={0.01}
                  value={props.selectedImage.cropFocalY ?? 0.5}
                  onChange={(value) => props.onSelectedImageChange({ cropFocalY: value })}
                  onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                    'cropFocalY',
                    String(initialValue)
                  )}
                />
                <output>{Math.round((props.selectedImage.cropFocalY ?? 0.5) * 100)}%</output>
              </label>
            </>
          )}
          <button
            type="button"
            className="document-context-button document-context-button--quiet"
            data-testid="document-image-reset-crop"
            onClick={props.onResetSelectedImageCrop}
          >
            Reset crop
          </button>
          {props.selectedImage.kind === 'flow' ? (
            ([
              ['Top', 'wrapPaddingTopPx'],
              ['Right', 'wrapPaddingRightPx'],
              ['Bottom', 'wrapPaddingBottomPx'],
              ['Left', 'wrapPaddingLeftPx'],
            ] as const).map(([label, key]) => (
              <label className="document-context-field" key={key}>
                <span>Wrap {label.toLowerCase()}</span>
                <CommittedInput
                  aria-label={`Image wrap padding ${label.toLowerCase()}`}
                  data-testid={`document-image-wrap-padding-${label.toLowerCase()}`}
                  type="number"
                  min="0"
                  max="96"
                  value={props.selectedImage?.[key] || 0}
                  onChange={(event) => props.onSelectedImageChange({
                    [key]: Math.min(
                      96,
                      Math.max(
                        0,
                        numericValue(
                          event.target.value,
                          props.selectedImage?.[key] || 0
                        )
                      )
                    ),
                  })}
                  onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                    key,
                    initialValue
                  )}
                />
              </label>
            ))
          ) : (
            <>
              <label className="document-context-field">
                <span>X</span>
                <CommittedInput
                  aria-label="Overlay X position"
                  type="number"
                  value={Math.round(props.selectedImage.xPx || 0)}
                  onChange={(event) => props.onSelectedImageChange({
                    xPx: Math.max(
                      0,
                      numericValue(event.target.value, props.selectedImage!.xPx || 0)
                    ),
                  })}
                  onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                    'xPx',
                    initialValue
                  )}
                />
              </label>
              <label className="document-context-field">
                <span>Y</span>
                <CommittedInput
                  aria-label="Overlay Y position"
                  type="number"
                  value={Math.round(props.selectedImage.yPx || 0)}
                  onChange={(event) => props.onSelectedImageChange({
                    yPx: Math.max(
                      0,
                      numericValue(event.target.value, props.selectedImage!.yPx || 0)
                    ),
                  })}
                  onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                    'yPx',
                    initialValue
                  )}
                />
              </label>
            </>
          )}
          <label className="document-context-field document-context-field--wide">
            <span>Caption</span>
            <CommittedInput
              aria-label="Image caption"
              data-testid="document-image-caption"
              value={props.selectedImage.caption}
              placeholder="Optional caption"
              onChange={(event) => props.onSelectedImageChange({
                caption: event.target.value,
              })}
              onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                'caption',
                initialValue
              )}
            />
          </label>
          <label className="document-context-field">
            <span>Caption alignment</span>
            <select
              aria-label="Caption alignment"
              data-testid="document-image-caption-alignment"
              value={props.selectedImage.captionAlignment}
              onChange={(event) => props.onSelectedImageChange({
                captionAlignment: event.target.value as
                  DocumentImageInspectorValue['captionAlignment'],
              })}
            >
              <option value="inherit">Named caption style</option>
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </select>
          </label>
          <label className="document-context-field">
            <span>Caption style</span>
            <select
              aria-label="Caption italic style"
              data-testid="document-image-caption-italic"
              value={
                props.selectedImage.captionItalic === 'inherit'
                  ? 'inherit'
                  : props.selectedImage.captionItalic ? 'italic' : 'roman'
              }
              onChange={(event) => props.onSelectedImageChange({
                captionItalic: event.target.value === 'inherit'
                  ? 'inherit'
                  : event.target.value === 'italic',
              })}
            >
              <option value="inherit">Named caption style</option>
              <option value="italic">Italic</option>
              <option value="roman">Roman</option>
            </select>
          </label>
          <label className="document-context-field">
            <span>Caption spacing</span>
            <CommittedInput
              aria-label="Caption spacing"
              data-testid="document-image-caption-spacing"
              type="number"
              min="0"
              max="96"
              value={
                props.selectedImage.captionSpacingPx === 'inherit'
                  ? ''
                  : props.selectedImage.captionSpacingPx
              }
              placeholder="Style"
              onChange={(event) => props.onSelectedImageChange({
                captionSpacingPx: event.target.value === ''
                  ? 'inherit'
                  : Math.min(
                      96,
                      Math.max(
                        0,
                        numericValue(event.target.value, 5)
                      )
                    ),
              })}
              onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                'captionSpacingPx',
                initialValue
              )}
            />
          </label>
          <label className="document-context-field document-context-field--wide">
            <span>Alt text</span>
            <CommittedInput
              aria-label="Image alt text"
              data-testid="document-image-alt"
              value={props.selectedImage.altText}
              placeholder="Describe this photo"
              onChange={(event) => props.onSelectedImageChange({
                altText: event.target.value,
              })}
              onCommit={(_value, initialValue) => props.onSelectedImageCommit?.(
                'altText',
                initialValue
              )}
            />
          </label>
          <button
            type="button"
            className="document-context-button document-context-button--quiet"
            onClick={() => replaceInputRef.current?.click()}
          >
            <Upload size={15} aria-hidden="true" />
            Replace
          </button>
          <input
            ref={replaceInputRef}
            className="document-visually-hidden"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) props.onReplaceSelectedImage(file);
              event.target.value = '';
            }}
          />
          <button
            type="button"
            className="document-context-button document-context-button--quiet"
            onClick={props.onResetSelectedImageSize}
          >
            Reset size
          </button>
          <button
            type="button"
            className="document-context-button document-context-button--danger"
            onClick={props.onDeleteSelectedImage}
          >
            <Trash2 size={15} aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : (props.selectedImageIds?.length ?? 0) > 1
        || props.selectedImageGroup ? (
        <div
          className="document-context-toolbar__content document-image-inspector"
          data-testid="document-image-inspector"
        >
          <DocumentImageGroupControls
            selectedImageIds={props.selectedImageIds ?? []}
            selectedImageGroup={props.selectedImageGroup}
            onArrangeSelectedImages={props.onArrangeSelectedImages}
            onSelectedImageGroupChange={props.onSelectedImageGroupChange}
            onSelectedImageGroupCommit={props.onSelectedImageGroupCommit}
            onUngroupSelectedImages={props.onUngroupSelectedImages}
            onAlignSelectedImages={props.onAlignSelectedImages}
            onDistributeSelectedImages={props.onDistributeSelectedImages}
          />
        </div>
      ) : (
        <div className="document-context-toolbar__content">
          <div className="document-context-heading">
            <span>Editing</span>
            <strong>{props.activeTextRegion === 'title' ? 'Title' : 'Body text'}</strong>
          </div>
          <div className="document-context-button-group" aria-label="History">
            <FormatButton label="Undo" onClick={() => props.onFormat('undo')}>
              <Undo2 size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton label="Redo" onClick={() => props.onFormat('redo')}>
              <Redo2 size={17} aria-hidden="true" />
            </FormatButton>
          </div>
          <div className="document-context-divider" aria-hidden="true" />
          {props.activeTextRegion === 'body' && (
            <label className="document-context-field">
              <span>Block style</span>
              <select
                aria-label="Body block style"
                data-testid="document-block-style"
                value={props.textFormatState.blockStyleId}
                onChange={(event) => props.onBlockStyleChange(
                  event.target.value as DocumentBlockStyleId
                )}
              >
                {props.textFormatState.blockStyleId === 'mixed' && (
                  <option value="mixed" disabled>Mixed</option>
                )}
                <option value="body">Body</option>
                <option value="subsection-heading">Subsection heading</option>
                <option value="quotation">Quotation / scripture</option>
                <option value="author-signature">Author / signature</option>
              </select>
            </label>
          )}
          {props.activeTextRegion === 'body' && (
            <>
              <div className="document-context-divider" aria-hidden="true" />
              <div
                className="document-context-button-group"
                aria-label="Paragraph flow controls"
              >
                <FormatButton
                  label="Insert column break"
                  active={props.textFormatState.columnBreakBefore}
                  onClick={() => props.onFlowControl?.('column-break')}
                >
                  <span aria-hidden="true">↪</span>
                </FormatButton>
                <FormatButton
                  label="Keep with next"
                  active={props.textFormatState.keepWithNext}
                  onClick={() => props.onFlowControl?.('keep-with-next')}
                >
                  <span aria-hidden="true">↕</span>
                </FormatButton>
                <FormatButton
                  label="Keep lines together"
                  active={props.textFormatState.keepLinesTogether}
                  onClick={() => props.onFlowControl?.('keep-lines-together')}
                >
                  <span aria-hidden="true">≡</span>
                </FormatButton>
              </div>
              <div className="document-context-divider" aria-hidden="true" />
            </>
          )}
          <label className="document-context-field document-context-field--font-size">
            <span>
              {props.activeTextRegion === 'title' ? 'Title size' : 'Body size'}
            </span>
            <select
              aria-label={
                props.activeTextRegion === 'title'
                  ? 'Title text font size'
                  : 'Body text font size'
              }
              data-testid="document-font-size"
              value={String(fontSizeValue)}
              onChange={(event) => {
                const fontSizePt = Number(event.target.value);
                if (Number.isFinite(fontSizePt)) {
                  props.onFontSizeChange(fontSizePt);
                }
              }}
            >
              {fontSizeValue === 'mixed' && (
                <option value="mixed">Mixed</option>
              )}
              {!hasPresetFontSize && fontSizeValue !== 'mixed' && (
                <option value={String(fontSizeValue)}>
                  {fontSizeValue} pt
                </option>
              )}
              {DOCUMENT_FONT_SIZES_PT.map((fontSizePt) => (
                <option key={fontSizePt} value={fontSizePt}>
                  {fontSizePt} pt
                </option>
              ))}
            </select>
          </label>
          <div className="document-context-divider" aria-hidden="true" />
          <div className="document-context-button-group" aria-label="Text style">
            <FormatButton
              label="Bold"
              active={props.textFormatState.bold}
              onClick={() => props.onFormat('bold')}
            >
              <Bold size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton
              label="Italic"
              active={props.textFormatState.italic}
              onClick={() => props.onFormat('italic')}
            >
              <Italic size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton
              label="Underline"
              active={props.textFormatState.underline}
              onClick={() => props.onFormat('underline')}
            >
              <Underline size={17} aria-hidden="true" />
            </FormatButton>
          </div>
          <div className="document-context-divider" aria-hidden="true" />
          <div className="document-context-button-group" aria-label="Text alignment">
            <FormatButton
              label="Align left"
              active={props.textFormatState.alignment === 'left'}
              onClick={() => props.onFormat('align-left')}
            >
              <AlignLeft size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton
              label="Align center"
              active={props.textFormatState.alignment === 'center'}
              onClick={() => props.onFormat('align-center')}
            >
              <AlignCenter size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton
              label="Align right"
              active={props.textFormatState.alignment === 'right'}
              onClick={() => props.onFormat('align-right')}
            >
              <AlignRight size={17} aria-hidden="true" />
            </FormatButton>
            <FormatButton
              label="Justify"
              active={props.textFormatState.alignment === 'justify'}
              onClick={() => props.onFormat('align-justify')}
            >
              <AlignJustify size={17} aria-hidden="true" />
            </FormatButton>
          </div>
          <div className="document-context-divider" aria-hidden="true" />
          <button
            type="button"
            className="document-context-button"
            onClick={() => imageInputRef.current?.click()}
          >
            <ImagePlus size={17} aria-hidden="true" />
            Add photo
          </button>
          <input
            ref={imageInputRef}
            className="document-visually-hidden"
            data-testid="document-context-image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files.length) props.onImportImages(files);
              event.target.value = '';
            }}
          />
        </div>
      )}
    </div>
  );
};
