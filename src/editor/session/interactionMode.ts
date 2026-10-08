import type { EditorTool } from '../state/editorStore';

export type InteractionSurface =
  | 'canvas'
  | 'document-page'
  | 'prosemirror'
  | 'scan-reference'
  | 'overlay'
  | 'modal';

export type InteractionKeyboardScope =
  | 'canvas'
  | 'document'
  | 'text'
  | 'reference'
  | 'modal';

export type SelectionAuthority =
  | 'fabric'
  | 'document-projection'
  | 'prosemirror'
  | 'reference'
  | 'overlay'
  | 'modal'
  | 'none';

export type EscapeAction =
  | 'clear-canvas-selection'
  | 'clear-document-selection'
  | 'blur-text'
  | 'cancel-reference-adjustment'
  | 'clear-overlay-selection'
  | 'close-modal'
  | 'none';

type InteractionModeIdentity = Readonly<{
  sessionIdentity: string;
  pageId: string | null;
}>;

export type CanvasEditingMode = InteractionModeIdentity & Readonly<{
  kind: 'canvas-editing';
  tool: EditorTool;
  surface: 'canvas';
  keyboardScope: 'canvas';
  selectionAuthority: 'fabric';
  escape: 'clear-canvas-selection';
}>;

export type DocumentIdleMode = InteractionModeIdentity & Readonly<{
  kind: 'document-idle';
  surface: 'document-page';
  keyboardScope: 'document';
  selectionAuthority: 'document-projection';
  escape: 'clear-document-selection';
}>;

export type TextEditingMode = InteractionModeIdentity & Readonly<{
  kind: 'text-editing';
  region: 'title' | 'body';
  surface: 'prosemirror';
  keyboardScope: 'text';
  selectionAuthority: 'prosemirror';
  escape: 'blur-text';
}>;

export type PhotoManipulationMode = InteractionModeIdentity & Readonly<{
  kind: 'photo-manipulation';
  imageIds: readonly string[];
  primaryImageId: string;
  groupId: string | null;
  surface: 'prosemirror';
  keyboardScope: 'document';
  selectionAuthority: 'document-projection';
  escape: 'clear-document-selection';
}>;

export type OverlayManipulationMode = InteractionModeIdentity & Readonly<{
  kind: 'overlay-manipulation';
  overlayId: string;
  surface: 'overlay';
  keyboardScope: 'document';
  selectionAuthority: 'overlay';
  escape: 'clear-overlay-selection';
}>;

export type ReferenceAdjustmentMode = InteractionModeIdentity & Readonly<{
  kind: 'reference-adjustment';
  assetId: string;
  surface: 'scan-reference';
  keyboardScope: 'reference';
  selectionAuthority: 'reference';
  escape: 'cancel-reference-adjustment';
}>;

export type ModalInteractionMode = InteractionModeIdentity & Readonly<{
  kind: 'modal';
  dialogId: string;
  returnKind: Exclude<InteractionMode['kind'], 'modal'>;
  surface: 'modal';
  keyboardScope: 'modal';
  selectionAuthority: 'modal';
  escape: 'close-modal';
}>;

export type InteractionMode =
  | CanvasEditingMode
  | DocumentIdleMode
  | TextEditingMode
  | PhotoManipulationMode
  | OverlayManipulationMode
  | ReferenceAdjustmentMode
  | ModalInteractionMode;

export type InteractionModeTransition =
  | Readonly<{ accepted: true; mode: InteractionMode }>
  | Readonly<{ accepted: false; mode: InteractionMode; reason: string }>;

export const createCanvasEditingMode = (
  sessionIdentity: string,
  pageId: string | null,
  tool: EditorTool = 'select',
): CanvasEditingMode => ({
  kind: 'canvas-editing',
  sessionIdentity,
  pageId,
  tool,
  surface: 'canvas',
  keyboardScope: 'canvas',
  selectionAuthority: 'fabric',
  escape: 'clear-canvas-selection',
});

export const createDocumentIdleMode = (
  sessionIdentity: string,
  pageId: string | null,
): DocumentIdleMode => ({
  kind: 'document-idle',
  sessionIdentity,
  pageId,
  surface: 'document-page',
  keyboardScope: 'document',
  selectionAuthority: 'document-projection',
  escape: 'clear-document-selection',
});

export const createTextEditingMode = (
  sessionIdentity: string,
  pageId: string,
  region: 'title' | 'body',
): TextEditingMode => ({
  kind: 'text-editing',
  sessionIdentity,
  pageId,
  region,
  surface: 'prosemirror',
  keyboardScope: 'text',
  selectionAuthority: 'prosemirror',
  escape: 'blur-text',
});

export const createPhotoManipulationMode = (
  sessionIdentity: string,
  pageId: string,
  options: {
    imageIds: readonly string[];
    primaryImageId: string;
    groupId?: string | null;
  },
): PhotoManipulationMode => ({
  kind: 'photo-manipulation',
  sessionIdentity,
  pageId,
  imageIds: [...new Set(options.imageIds)],
  primaryImageId: options.primaryImageId,
  groupId: options.groupId ?? null,
  surface: 'prosemirror',
  keyboardScope: 'document',
  selectionAuthority: 'document-projection',
  escape: 'clear-document-selection',
});

export const createOverlayManipulationMode = (
  sessionIdentity: string,
  pageId: string,
  overlayId: string,
): OverlayManipulationMode => ({
  kind: 'overlay-manipulation',
  sessionIdentity,
  pageId,
  overlayId,
  surface: 'overlay',
  keyboardScope: 'document',
  selectionAuthority: 'overlay',
  escape: 'clear-overlay-selection',
});

export const createReferenceAdjustmentMode = (
  sessionIdentity: string,
  pageId: string,
  assetId: string,
): ReferenceAdjustmentMode => ({
  kind: 'reference-adjustment',
  sessionIdentity,
  pageId,
  assetId,
  surface: 'scan-reference',
  keyboardScope: 'reference',
  selectionAuthority: 'reference',
  escape: 'cancel-reference-adjustment',
});

export const createModalInteractionMode = (
  sessionIdentity: string,
  pageId: string | null,
  dialogId: string,
  returnKind: Exclude<InteractionMode['kind'], 'modal'>,
): ModalInteractionMode => ({
  kind: 'modal',
  sessionIdentity,
  pageId,
  dialogId,
  returnKind,
  surface: 'modal',
  keyboardScope: 'modal',
  selectionAuthority: 'modal',
  escape: 'close-modal',
});

const isNonEmpty = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

const MODE_KINDS: readonly InteractionMode['kind'][] = [
  'canvas-editing',
  'document-idle',
  'text-editing',
  'photo-manipulation',
  'overlay-manipulation',
  'reference-adjustment',
  'modal',
];

const EDITOR_TOOLS: readonly EditorTool[] = [
  'select',
  'draw',
  'pan',
  'erase',
  'textbox',
];

const isOneOf = <Value>(value: unknown, values: readonly Value[]): value is Value => (
  values.includes(value as Value)
);

/** Detect invalid mode objects at untyped React/store boundaries. */
export const assertInteractionMode = (
  candidate: unknown,
): InteractionMode => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('An interaction mode must be an object.');
  }
  const mode = candidate as Record<string, unknown>;
  if (!isOneOf(mode.kind, MODE_KINDS)) {
    throw new Error('An interaction mode has an unknown kind.');
  }
  if (!isNonEmpty(mode.sessionIdentity)) {
    throw new Error('An interaction mode must identify its session.');
  }
  if (mode.pageId !== null && !isNonEmpty(mode.pageId)) {
    throw new Error('An interaction mode pageId must be non-empty or null.');
  }
  switch (mode.kind) {
    case 'canvas-editing':
      if (
        !isOneOf(mode.tool, EDITOR_TOOLS)
        || mode.surface !== 'canvas'
        || mode.keyboardScope !== 'canvas'
        || mode.selectionAuthority !== 'fabric'
        || mode.escape !== 'clear-canvas-selection'
      ) {
        throw new Error('Canvas editing mode has inconsistent ownership metadata.');
      }
      break;
    case 'document-idle':
      if (
        mode.surface !== 'document-page'
        || mode.keyboardScope !== 'document'
        || mode.selectionAuthority !== 'document-projection'
        || mode.escape !== 'clear-document-selection'
      ) {
        throw new Error('Document idle mode has inconsistent ownership metadata.');
      }
      break;
    case 'text-editing':
      if (
        mode.pageId === null
        || !isOneOf(mode.region, ['title', 'body'] as const)
        || mode.surface !== 'prosemirror'
        || mode.keyboardScope !== 'text'
        || mode.selectionAuthority !== 'prosemirror'
        || mode.escape !== 'blur-text'
      ) {
        throw new Error('Text editing requires a page and ProseMirror ownership.');
      }
      break;
    case 'photo-manipulation':
      if (
        mode.pageId === null
        || !Array.isArray(mode.imageIds)
        || mode.imageIds.length === 0
        || !mode.imageIds.every(isNonEmpty)
        || !isNonEmpty(mode.primaryImageId)
        || !mode.imageIds.includes(mode.primaryImageId)
        || (mode.groupId !== null && !isNonEmpty(mode.groupId))
        || mode.surface !== 'prosemirror'
        || mode.keyboardScope !== 'document'
        || mode.selectionAuthority !== 'document-projection'
        || mode.escape !== 'clear-document-selection'
      ) {
        throw new Error('Photo manipulation requires a selected image set and primary image.');
      }
      break;
    case 'overlay-manipulation':
      if (
        mode.pageId === null
        || !isNonEmpty(mode.overlayId)
        || mode.surface !== 'overlay'
        || mode.keyboardScope !== 'document'
        || mode.selectionAuthority !== 'overlay'
        || mode.escape !== 'clear-overlay-selection'
      ) {
        throw new Error('Overlay manipulation requires a page and overlay.');
      }
      break;
    case 'reference-adjustment':
      if (
        mode.pageId === null
        || !isNonEmpty(mode.assetId)
        || mode.surface !== 'scan-reference'
        || mode.keyboardScope !== 'reference'
        || mode.selectionAuthority !== 'reference'
        || mode.escape !== 'cancel-reference-adjustment'
      ) {
        throw new Error('Reference adjustment requires a page and asset.');
      }
      break;
    case 'modal':
      if (
        !isNonEmpty(mode.dialogId)
        || !isOneOf(mode.returnKind, MODE_KINDS.filter((kind) => kind !== 'modal'))
        || mode.surface !== 'modal'
        || mode.keyboardScope !== 'modal'
        || mode.selectionAuthority !== 'modal'
        || mode.escape !== 'close-modal'
      ) {
        throw new Error('Modal interaction has invalid dialog or ownership metadata.');
      }
      break;
  }
  return candidate as InteractionMode;
};

/**
 * Validate a transition against the active session/page. A replacement or
 * page change must explicitly reset to an idle mode; stale modes are rejected
 * rather than repaired later by competing effects.
 */
export const transitionInteractionMode = (
  current: InteractionMode,
  next: InteractionMode,
  context: Readonly<{
    sessionIdentity: string;
    activePageId: string | null;
  }>,
): InteractionModeTransition => {
  assertInteractionMode(current);
  assertInteractionMode(next);
  if (next.sessionIdentity !== context.sessionIdentity) {
    return {
      accepted: false,
      mode: current,
      reason: 'The proposed interaction mode belongs to another session.',
    };
  }
  if (
    next.pageId !== null
    && next.pageId !== context.activePageId
  ) {
    return {
      accepted: false,
      mode: current,
      reason: 'The proposed interaction mode belongs to another page.',
    };
  }
  return { accepted: true, mode: next };
};

export const interactionModeOwnsPointerInput = (
  mode: InteractionMode,
  surface: InteractionSurface,
) => mode.surface === surface;

export const interactionModeAllowsShortcut = (
  mode: InteractionMode,
  scope: InteractionKeyboardScope,
) => mode.keyboardScope === scope;
