import * as fabric from 'fabric';
import { ensureObjectId, isCanvasHydrating } from '../fabric/initFabricCanvas';
import { initSmartGuides } from '../fabric/smartGuides';
import { updateGuides, fitCanvasToViewport, centerDocumentInViewport } from '../fabric/canvasUtils';
import { useEditorStore } from '../state/editorStore';
import { drawSmartDistanceIndicators, clearSmartGuides } from '../utils/smartGuides';
import { frameScheduler, TaskPriority } from '../utils/frameScheduler';
import { isActiveSelection } from '../utils/typeGuards';
import {
    getCanvasObjectAssetEffect,
    isCanvasObjectMutationSuppressed,
    isCanvasObjectObservationTarget,
} from './canvasMutationObservation';
import type { CanvasCommittedMutation } from './canvasMutationObservation';
import type { AuthoredRevisionEvent } from '../session/authoredRevision';
import {
    handleTextboxMouseDown,
    handleTextboxMouseMove,
    handleTextboxMouseUp,
} from './textboxDrawingService';

/**
 * Canvas Event Service
 *
 * Centralized service for managing Fabric.js canvas event handlers.
 * Each event handler has a corresponding cleanup function to prevent
 * duplication on re-renders.
 *
 * Features:
 * - Grouped event handlers by concern (objects, selection, viewport, etc.)
 * - Automatic cleanup tracking
 * - AbortSignal support for cancellation
 * - Type-safe event handler registration
 */

// --- TYPES ---

export interface CanvasEventCallbacks {
    onUpdate?: (canvas: fabric.Canvas, options?: { persist?: boolean }) => void;
    onHistoryDirty?: () => void;
    /** Advance the renderer-owned authored revision immediately on mutation. */
    onAuthoredMutation?: (event?: AuthoredRevisionEvent) => void;
    /**
     * A narrow adapter observation for committed user geometry changes. The
     * callback receives a stable object ID, never the Fabric object itself.
     */
    /** Optional for standalone legacy mounts; required by the routed lifecycle adapter. */
    onCommittedMutation?: (mutation: CanvasCommittedMutation) => void;
    onSelectedObjectId?: (id: string | null) => void;
    onSelectedLayerIds?: (ids: string[]) => void;
    onSelectionChange?: (canvas: fabric.Canvas) => void;
    onZoom?: (zoom: number) => void;
    onViewportChange?: (canvas: fabric.Canvas) => void;
}

export type { CanvasCommittedMutation } from './canvasMutationObservation';

export interface EventHandlerCleanup {
    cleanup: () => void;
    type: 'canvas' | 'window' | 'observer' | 'custom';
}

export interface CanvasEventHandlerOptions {
    canvas: fabric.Canvas;
    abortSignal?: AbortSignal;
    callbacks: CanvasEventCallbacks;
    refs?: {
        activeTool?: React.MutableRefObject<string>;
        isSpacebarDown?: React.MutableRefObject<boolean>;
        isPanning?: React.MutableRefObject<boolean>;
        lastPosX?: React.MutableRefObject<number>;
        lastPosY?: React.MutableRefObject<number>;
    };
    config?: {
        snapEnabled?: boolean;
        gridEnabled?: boolean;
    };
}

export const dirtyObjects = new Set<string>();

const isEditableTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT' || target.isContentEditable;
};

const isTextObject = (obj: fabric.Object | null) => {
    if (!obj) return false;
    return obj.type === 'i-text' || obj.type === 'textbox' || obj.type === 'text';
};

const isTextEditing = (canvas: fabric.Canvas) => {
    const candidates = canvas.getObjects();
    return candidates.some((obj) => {
        if (!isTextObject(obj)) return false;
        const anyObj = obj as any;
        return !!anyObj.isEditing || !!anyObj.editing || !!anyObj.textEditing;
    });
};

// --- UTILITY FUNCTIONS ---

/**
 * Checks if the abort signal has been triggered.
 */
function checkAborted(abortSignal?: AbortSignal): boolean {
    return abortSignal?.aborted ?? false;
}

/**
 * Clamps pan position to prevent over-panning.
 */
export function clampPan(canvas: fabric.Canvas): void {
    const vpt = canvas.viewportTransform;
    if (!vpt) return;

    const zoom = canvas.getZoom();
    const viewWidth = canvas.getWidth();
    const viewHeight = canvas.getHeight();
    const halfWidth = (viewWidth * zoom) / 2;
    const halfHeight = (viewHeight * zoom) / 2;

    const minX = -halfWidth;
    const maxX = viewWidth - halfWidth;
    const minY = -halfHeight;
    const maxY = viewHeight - halfHeight;

    const nextX = Math.min(maxX, Math.max(minX, vpt[4]));
    const nextY = Math.min(maxY, Math.max(minY, vpt[5]));

    if (nextX === vpt[4] && nextY === vpt[5]) return;

    vpt[4] = nextX;
    vpt[5] = nextY;
    canvas.setViewportTransform(vpt);
}

// --- OBJECT EVENT HANDLERS ---

/**
 * Registers handlers for object lifecycle events (added, removed, modified, scaling).
 */
export function registerObjectEventHandlers(
    options: CanvasEventHandlerOptions
): EventHandlerCleanup {
    const { canvas, abortSignal, callbacks, refs } = options;
    const {
        onUpdate,
        onHistoryDirty,
        onAuthoredMutation,
        onSelectionChange,
        onCommittedMutation,
    } = callbacks;

    const notifyCommittedMutation = (mutation: CanvasCommittedMutation) => {
        if (!onCommittedMutation) return;
        try {
            onCommittedMutation(mutation);
        } catch (error) {
            // A committed observation is required by the shared lifecycle
            // route. Keep the engine mutation committed, but make a delivery
            // failure visible instead of misclassifying it as diagnostics.
            console.error(
                '[project-lifecycle] Canvas committed observation callback failed.',
                error,
            );
        }
    };

    type TextEditingSession = {
        initialText: string;
        liveMutationEmitted: boolean;
    };

    // Fabric 7 emits text:editing:exited before the changed-text
    // object:modified event. Keep the session boundary until that completion
    // event so legacy synchronization and saveState remain first.
    const textEditingSessions = new Map<string, TextEditingSession>();
    const textCommitsAwaitingObjectModified = new Map<string, TextEditingSession>();
    // Some integrations (and a few WebKit event paths) can emit text:changed
    // without the paired editing:entered event. Keep that first live mutation
    // visible to the lifecycle observer and suppress the later generic
    // object:modified geometry notification for the same edit.
    const textChangesAwaitingObjectModified = new Set<string>();

    const canObserveObjectLifecycle = (
        target?: fabric.Object
    ): target is fabric.Object & { id: string } => {
        if (!target || isCanvasObjectMutationSuppressed(canvas)) return false;
        if (useEditorStore.getState().syncLock?.isLocked) return false;
        return isCanvasObjectObservationTarget(target);
    };

    const markDirtyObject = (target?: fabric.Object) => {
        if (!target || (target as any).isGuide) return;
        ensureObjectId(target, canvas);
        const id = (target as any).id;
        if (typeof id === 'string' && id.trim().length > 0) {
            dirtyObjects.add(id);
        }
    };

    const handleObjectMoving = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        const target = event?.target as fabric.Object | undefined;
        if (!target || (target as any).isGuide) return;
        markDirtyObject(target);

        // Draw smart distance indicators while dragging
        if (canvas && target) {
            clearSmartGuides(canvas);
            drawSmartDistanceIndicators(canvas, target, canvas.getObjects());
        }
    };

    const handleObjectRemoved = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        const target = event?.target as fabric.Object | undefined;
        const isInternalMutation = !!(target as any)?.__layerSyncing
            || !!useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas);

        if (target && !(target as any).isGuide && !isInternalMutation) {
            // The Fabric event is the early visibility edge. The paired
            // committed observer below owns the semantic commit, so the
            // shared lifecycle sees a draft followed by one commit.
            onAuthoredMutation?.({ kind: 'draft-start', source: 'canvas' });
            onSelectionChange?.(canvas);
            onHistoryDirty?.();
            onUpdate?.(canvas, { persist: true });
        }

        const objectId = (target as any)?.id;
        if (typeof objectId === 'string') {
            textEditingSessions.delete(objectId);
            textCommitsAwaitingObjectModified.delete(objectId);
            textChangesAwaitingObjectModified.delete(objectId);
        }

        // Clean up blob URLs for images
        if (target?.type === 'image' && !isInternalMutation) {
            const id = (target as any).id as string | undefined;
            if (id) {
                const { decrementAssetRef } = useEditorStore.getState();
                decrementAssetRef(id);
            }
        }

        if (canObserveObjectLifecycle(target)) {
            notifyCommittedMutation({
                action: 'remove-freeform-object',
                objectId: target.id,
                assetEffect: getCanvasObjectAssetEffect(
                    'remove-freeform-object',
                    target
                ),
            });
        }
    };

    const handleObjectModified = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        if (
            useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas)
        ) return;
        const target = event?.target as fabric.Object | undefined;
        if (!target || (target as any).isGuide) return;

        const objectId = (target as any).id;
        const pendingTextSession = typeof objectId === 'string'
            ? textCommitsAwaitingObjectModified.get(objectId)
            : undefined;
        const textChangeWithoutSession = typeof objectId === 'string'
            ? textChangesAwaitingObjectModified.delete(objectId)
            : false;
        const finalText = String((target as any).text ?? '');
        // A text:changed event has already marked the authored revision. The
        // later Fabric completion event is bookkeeping, not another mutation.
        // For integrations that omit text:changed, the changed value is still
        // marked here as the fallback boundary. A no-session text change is
        // likewise already marked by text:changed and is suppressed below.
        if (
            !textChangeWithoutSession
            && (
                !pendingTextSession
                || (
                    !pendingTextSession.liveMutationEmitted
                    && pendingTextSession.initialText !== finalText
                )
            )
        ) {
            // A changed-text event can precede Fabric's semantic completion.
            // Treat it as a draft start; the completion observer below is the
            // single committed authored boundary.
            onAuthoredMutation?.({ kind: 'draft-start', source: 'canvas' });
        }
        markDirtyObject(target);
        onHistoryDirty?.();
        onUpdate?.(canvas, { persist: true });

        if (pendingTextSession) {
            textCommitsAwaitingObjectModified.delete(objectId);

            // Fabric's changed-text object:modified is the completion event
            // for the editing session. It must not be reinterpreted as a
            // geometry command as well.
            if (
                !pendingTextSession.liveMutationEmitted
                && pendingTextSession.initialText !== finalText
                && canvas.getObjects().includes(target)
                && isCanvasObjectObservationTarget(target)
                && !isCanvasObjectMutationSuppressed(canvas)
                && !useEditorStore.getState().syncLock?.isLocked
            ) {
                notifyCommittedMutation({
                    action: 'modify-freeform-text-content',
                    objectId,
                });
            }
            return;
        }
        if (textChangeWithoutSession) return;

        // Clear smart guides when object movement is complete
        if (canvas) {
            clearSmartGuides(canvas);
        }

        if (
            typeof objectId === 'string'
            && objectId.trim().length > 0
            && canvas.getObjects().includes(target)
            && isCanvasObjectObservationTarget(target)
        ) {
            notifyCommittedMutation({
                action: 'modify-freeform-geometry',
                objectId,
            });
        }
    };

    const handleTextEditingEntered = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        if (
            useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas)
        ) return;
        const target = event?.target as fabric.Object | undefined;
        const objectId = (target as any)?.id;
        if (
            !target
            || !isTextObject(target)
            || typeof objectId !== 'string'
            || objectId.trim().length === 0
            || !canvas.getObjects().includes(target)
            || !isCanvasObjectObservationTarget(target)
        ) return;
        textEditingSessions.set(objectId, {
            initialText: String((target as any).text ?? ''),
            liveMutationEmitted: false,
        });
        textChangesAwaitingObjectModified.delete(objectId);
    };

    const handleTextEditingExited = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        if (
            useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas)
        ) return;
        const target = event?.target as fabric.Object | undefined;
        const objectId = (target as any)?.id;
        if (
            !target
            || !isTextObject(target)
            || typeof objectId !== 'string'
            || objectId.trim().length === 0
            || !canvas.getObjects().includes(target)
        ) return;
        const session = textEditingSessions.get(objectId);
        textEditingSessions.delete(objectId);
        textChangesAwaitingObjectModified.delete(objectId);
        if (!session || String((target as any).text ?? '') === session.initialText) {
            return;
        }
        // A live text:changed event already advanced the authored/lifecycle
        // revision for this editing session. Keep the exit event as the
        // semantic completion boundary without counting the same edit twice.
        if (session.liveMutationEmitted) {
            textChangesAwaitingObjectModified.add(objectId);
            return;
        }
        textCommitsAwaitingObjectModified.set(objectId, session);
    };

    const handleTextChanged = (event?: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        if (
            useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas)
        ) return;
        const target = event?.target as fabric.Object | undefined;
        if (!target || !isTextObject(target)) return;

        const session = typeof (target as any).id === 'string'
            ? textEditingSessions.get((target as any).id)
            : undefined;
        const hasPendingTextChange = typeof (target as any).id === 'string'
            && textChangesAwaitingObjectModified.has((target as any).id);

        // Mark the authored mutation once per dirty period instead of on
        // every keystroke. The first change flips isDirty, bumps the
        // revision, and schedules the debounced autosave; later keystrokes
        // only refresh that timer. Broadcasting the full editor store (plus
        // the lifecycle snapshot) on every keystroke is what made canvas
        // text input lag. Durability is unchanged: the timer still fires
        // after typing pauses, and completion persists explicitly.
        if (useEditorStore.getState().isDirty) {
            useEditorStore.getState().triggerAutoSave();
        } else {
            onAuthoredMutation?.({
                kind: session?.liveMutationEmitted || hasPendingTextChange
                    ? 'draft-update'
                    : 'draft-start',
                source: 'canvas',
            });
        }
        markDirtyObject(target);
        onHistoryDirty?.();
        // Live keystrokes do not touch the store sync path at all. Fabric
        // owns the live text and repaints itself on every keydown; the
        // object:modified completion handler (blur/Escape) performs the
        // single store sync + persist for the whole session, and the
        // debounced autosave covers durability in between. Syncing the full
        // canvas (serialize + layer rebuild + layout suggestions + store
        // broadcast to every subscriber) on every keystroke is what made
        // canvas text input lag.

        // Fabric emits text:changed for each visible edit, before the blur /
        // object:modified completion pair. Report the first changed value at
        // that boundary so lifecycle dirty state cannot lag behind authored
        // text while the editor remains focused. The completion callback
        // remains a fallback for integrations that omit text:changed.
        const objectId = (target as any).id;
        if (
            session
            && !session.liveMutationEmitted
            && String((target as any).text ?? '') !== session.initialText
            && canObserveObjectLifecycle(target)
        ) {
            session.liveMutationEmitted = true;
            notifyCommittedMutation({
                action: 'modify-freeform-text-content',
                objectId,
            });
        } else if (
            typeof objectId === 'string'
            && canObserveObjectLifecycle(target)
            && !textChangesAwaitingObjectModified.has(objectId)
        ) {
            // Keep dirty/lifecycle state truthful even when the browser omits
            // text:editing:entered. The set prevents the subsequent
            // object:modified completion from being misclassified as
            // geometry, while later visible edits remain coalesced until that
            // completion boundary.
            textChangesAwaitingObjectModified.add(objectId);
            notifyCommittedMutation({
                action: 'modify-freeform-text-content',
                objectId,
            });
        }
    };

    const handleObjectScaling = (event: any) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        const target = event.target as fabric.Object | undefined;
        if (!target || (target as any).isGuide) return;
        if (target.type !== 'rect') return;

        const rect = target as fabric.Rect;
        const rx = rect.rx ?? 0;
        const ry = rect.ry ?? 0;
        if (!rx && !ry) return;

        const scaleX = Math.abs(rect.scaleX ?? 1);
        const scaleY = Math.abs(rect.scaleY ?? 1);
        if (!scaleX || !scaleY) return;

        const baseRx = (rect as any).__baseRx ?? rx * scaleX;
        const baseRy = (rect as any).__baseRy ?? ry * scaleY;
        (rect as any).__baseRx = baseRx;
        (rect as any).__baseRy = baseRy;

        rect.set({
            rx: baseRx / scaleX,
            ry: baseRy / scaleY,
        });
    };

    const handleObjectAdded = (event: { target?: fabric.Object }) => {
        if (checkAborted(abortSignal)) return;
        if (isCanvasHydrating(canvas)) return;
        const target = event.target as fabric.Object | undefined;
        if (!target) return;
        if ((target as any).isGuide) return;
        if ((target as any).__layerSyncing) return;
        if (
            useEditorStore.getState().syncLock?.isLocked
            || isCanvasObjectMutationSuppressed(canvas)
        ) return;

        ensureObjectId(target, canvas);
        if (target.type === 'image') {
            const id = (target as any).id as string | undefined;
            if (id) {
                const { incrementAssetRef } = useEditorStore.getState();
                incrementAssetRef(id);
            }
        }

        const activeTool = refs?.activeTool?.current;
        if (activeTool === 'draw' || activeTool === 'erase') {
            onHistoryDirty?.();
        }

            onAuthoredMutation?.({ kind: 'draft-start', source: 'canvas' });
        onUpdate?.(canvas, { persist: true });

        if (canObserveObjectLifecycle(target)) {
            notifyCommittedMutation({
                action: 'add-freeform-object',
                objectId: target.id,
                assetEffect: getCanvasObjectAssetEffect(
                    'add-freeform-object',
                    target
                ),
            });
        }
    };

    // Register event listeners
    canvas.on('object:added', handleObjectAdded);
    canvas.on('object:removed', handleObjectRemoved);
    canvas.on('object:modified', handleObjectModified);
    canvas.on('text:changed', handleTextChanged);
    canvas.on('text:editing:entered', handleTextEditingEntered);
    canvas.on('text:editing:exited', handleTextEditingExited);
    canvas.on('object:moving', handleObjectMoving);
    canvas.on('object:scaling', handleObjectScaling);

    return {
        cleanup: () => {
            canvas.off('object:added', handleObjectAdded);
            canvas.off('object:removed', handleObjectRemoved);
            canvas.off('object:modified', handleObjectModified);
            canvas.off('text:changed', handleTextChanged);
            canvas.off('text:editing:entered', handleTextEditingEntered);
            canvas.off('text:editing:exited', handleTextEditingExited);
            canvas.off('object:moving', handleObjectMoving);
            canvas.off('object:scaling', handleObjectScaling);
            textEditingSessions.clear();
            textCommitsAwaitingObjectModified.clear();
            textChangesAwaitingObjectModified.clear();
        },
        type: 'canvas',
    };
}

// --- SELECTION EVENT HANDLERS ---

/**
 * Registers handlers for selection events (created, updated, cleared).
 */
export function registerSelectionEventHandlers(
    options: CanvasEventHandlerOptions
): EventHandlerCleanup {
    const { canvas, callbacks } = options;
    const { onSelectedObjectId, onSelectedLayerIds, onSelectionChange } = callbacks;

    const applySelectionState = () => {
        if (onSelectionChange) {
            onSelectionChange(canvas);
            return;
        }
        const activeObject = canvas.getActiveObject();
        const activeId = activeObject && !isActiveSelection(activeObject)
            ? (activeObject as any).id
            : null;
        onSelectedObjectId?.(typeof activeId === 'string' && activeId.trim().length > 0 ? activeId : null);

        if (!activeObject) {
            onSelectedLayerIds?.([]);
            return;
        }

        if (isActiveSelection(activeObject)) {
            const ids = (activeObject as fabric.ActiveSelection)
                .getObjects()
                .map((obj) => (obj as any).id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
            onSelectedLayerIds?.(ids);
            return;
        }

        const id = (activeObject as any).id;
        if (typeof id === 'string' && id.trim().length > 0) {
            onSelectedLayerIds?.([id]);
        } else {
            onSelectedLayerIds?.([]);
        }
    };

    const handleSelectionCreated = (event?: { selected?: fabric.Object[] }) => {
        if (onSelectionChange) {
            onSelectionChange(canvas);
            return;
        }
        const selected = event?.selected;
        if (Array.isArray(selected) && selected.length > 1) {
            onSelectedObjectId?.(null);
            const ids = selected
                .map((obj) => (obj as any).id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
            onSelectedLayerIds?.(ids);
            return;
        }
        applySelectionState();
    };

    const handleSelectionUpdated = (event?: { selected?: fabric.Object[] }) => {
        if (onSelectionChange) {
            onSelectionChange(canvas);
            return;
        }
        const selected = event?.selected;
        if (Array.isArray(selected) && selected.length > 1) {
            onSelectedObjectId?.(null);
            const ids = selected
                .map((obj) => (obj as any).id)
                .filter((id): id is string => typeof id === 'string' && id.trim().length > 0);
            onSelectedLayerIds?.(ids);
            return;
        }
        applySelectionState();
    };

    const handleSelectionCleared = () => {
        if (onSelectionChange) {
            onSelectionChange(canvas);
            return;
        }
        onSelectedObjectId?.(null);
        onSelectedLayerIds?.([]);
    };

    canvas.on('selection:created', handleSelectionCreated);
    canvas.on('selection:updated', handleSelectionUpdated);
    canvas.on('selection:cleared', handleSelectionCleared);

    return {
        cleanup: () => {
            canvas.off('selection:created', handleSelectionCreated);
            canvas.off('selection:updated', handleSelectionUpdated);
            canvas.off('selection:cleared', handleSelectionCleared);
        },
        type: 'canvas',
    };
}

// --- VIEWPORT EVENT HANDLERS ---

/**
 * Registers handlers for viewport events (rendering, mouse wheel zoom).
 * Zoom keeps the document centered in the viewport.
 */
export function registerViewportEventHandlers(
    options: CanvasEventHandlerOptions
): EventHandlerCleanup {
    const { canvas, callbacks } = options;
    const { onZoom, onViewportChange } = callbacks;

    const handleMouseWheel = (opt: fabric.TPointerEventInfo<WheelEvent>) => {
        const evt = opt.e as WheelEvent;
        let zoom = canvas.getZoom();
        const zoomFactor = 0.999 ** evt.deltaY;
        zoom *= zoomFactor;

        const clampedZoom = Math.min(20, Math.max(0.05, zoom));

        // Zoom keeping the document centered using the shared utility
        centerDocumentInViewport(canvas, clampedZoom);

        onZoom?.(clampedZoom);
        onViewportChange?.(canvas);

        evt.preventDefault();
        evt.stopPropagation();
    };

    canvas.on('mouse:wheel', handleMouseWheel);

    return {
        cleanup: () => {
            canvas.off('mouse:wheel', handleMouseWheel);
        },
        type: 'canvas',
    };
}

// --- PAN EVENT HANDLERS ---

/**
 * Registers handlers for panning (mouse down/move/up with spacebar or pan tool).
 * Supports:
 * - Pan tool: click and drag to pan
 * - Spacebar + drag: hold space and drag to pan (in select mode)
 * - Right-click drag: pan with right mouse button
 * - Middle-click drag: pan with middle mouse button
 */
export function registerPanEventHandlers(
    options: CanvasEventHandlerOptions
): EventHandlerCleanup {
    const { canvas, callbacks, refs } = options;
    const { onViewportChange } = callbacks;

    if (!refs) {
        console.warn('[registerPanEventHandlers] Refs required for pan handlers');
        return { cleanup: () => {}, type: 'canvas' };
    }

    const { activeTool, isSpacebarDown, isPanning, lastPosX, lastPosY } = refs;

    // Track auxiliary button panning (right-click or middle-click)
    let isAuxPanning = false;
    let auxLastPosX = 0;
    let auxLastPosY = 0;
    let previousCursor = canvas.defaultCursor;
    let previousSelection = canvas.selection;

    const startPan = (clientX: number, clientY: number, isAux = false) => {
        if (isAux) {
            isAuxPanning = true;
            previousCursor = canvas.defaultCursor;
            previousSelection = canvas.selection;
            canvas.selection = false;
            auxLastPosX = clientX;
            auxLastPosY = clientY;
        } else if (isPanning && lastPosX && lastPosY) {
            isPanning.current = true;
            lastPosX.current = clientX;
            lastPosY.current = clientY;
        }
        canvas.defaultCursor = 'grabbing';
        canvas.setCursor('grabbing');
    };

    const updatePan = (clientX: number, clientY: number) => {
        let deltaX: number;
        let deltaY: number;

        if (isAuxPanning) {
            deltaX = clientX - auxLastPosX;
            deltaY = clientY - auxLastPosY;
            auxLastPosX = clientX;
            auxLastPosY = clientY;
        } else if (isPanning?.current && lastPosX && lastPosY) {
            deltaX = clientX - lastPosX.current;
            deltaY = clientY - lastPosY.current;
            lastPosX.current = clientX;
            lastPosY.current = clientY;
        } else {
            return;
        }

        canvas.relativePan(new fabric.Point(deltaX, deltaY));
        onViewportChange?.(canvas);
    };

    const endPan = (isAux = false) => {
        if (isAux && isAuxPanning) {
            isAuxPanning = false;
            canvas.selection = previousSelection;
            canvas.defaultCursor = previousCursor;
        } else if (!isAux && isPanning) {
            isPanning.current = false;
        }

        // Restore cursor based on current state
        const tool = activeTool?.current;
        if (tool === 'pan') {
            canvas.setCursor('grab');
        } else if (tool === 'select' && isSpacebarDown?.current) {
            canvas.setCursor('grab');
        } else {
            canvas.setCursor(canvas.defaultCursor);
        }
    };

    const onMouseDown = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        if (!activeTool || !isSpacebarDown || !isPanning || !lastPosX || !lastPosY) return;

        const e = opt.e as MouseEvent;
        const tool = activeTool.current;

        // Handle textbox drawing tool
        if (tool === 'textbox' && e.button === 0) {
            handleTextboxMouseDown(canvas, e);
            e.preventDefault();
            return;
        }

        // Right-click (button 2) or middle-click (button 1) - auxiliary panning
        if (e.button === 2 || e.button === 1) {
            startPan(e.clientX, e.clientY, true);
            e.preventDefault();
            return;
        }

        // Left-click panning conditions:
        // 1. Pan tool is active
        // 2. Select tool with spacebar held
        const shouldPan = tool === 'pan' || (tool === 'select' && isSpacebarDown.current);

        if (shouldPan && e.button === 0) {
            startPan(e.clientX, e.clientY, false);
        }
    };

    const onMouseMove = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        const e = opt.e as MouseEvent;
        const tool = activeTool?.current;

        // Handle textbox drawing tool
        if (tool === 'textbox') {
            handleTextboxMouseMove(canvas, e);
            return;
        }

        // Check if we're panning
        if (isAuxPanning || isPanning?.current) {
            updatePan(e.clientX, e.clientY);
        }
    };

    const onMouseUp = (opt: fabric.TPointerEventInfo<fabric.TPointerEvent>) => {
        const e = opt.e as MouseEvent;
        const tool = activeTool?.current;

        // Handle textbox drawing tool
        if (tool === 'textbox' && e.button === 0) {
            handleTextboxMouseUp(canvas, e);
            return;
        }

        // End auxiliary panning (right or middle click)
        if (isAuxPanning && (e.button === 2 || e.button === 1)) {
            endPan(true);
            return;
        }

        // End left-click panning
        if (isPanning?.current && e.button === 0) {
            endPan(false);
        }
    };

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);

    return {
        cleanup: () => {
            canvas.off('mouse:down', onMouseDown);
            canvas.off('mouse:move', onMouseMove);
            canvas.off('mouse:up', onMouseUp);
        },
        type: 'canvas',
    };
}

// --- KEYBOARD EVENT HANDLERS ---

/**
 * Registers global keyboard handlers for spacebar panning.
 */
export function registerKeyboardEventHandlers(
    options: CanvasEventHandlerOptions
): EventHandlerCleanup {
    const { canvas, refs } = options;

    if (!refs || !refs.activeTool || !refs.isSpacebarDown) {
        console.warn('[registerKeyboardEventHandlers] Refs required for keyboard handlers');
        return { cleanup: () => {}, type: 'window' };
    }

    const { activeTool, isSpacebarDown } = refs;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
        if (
            isEditableTarget(e.target)
            || isEditableTarget(document.activeElement)
            || isTextEditing(canvas)
        ) {
            return;
        }
        if (activeTool.current !== 'select') return;
        if (e.code === 'Space' && !isSpacebarDown.current) {
            e.preventDefault();
            isSpacebarDown.current = true;
            canvas.setCursor('grab');
            canvas.selection = false;
            canvas.requestRenderAll();
        }
    };

    const handleGlobalKeyUp = (e: KeyboardEvent) => {
        if (activeTool.current !== 'select') return;
        if (e.code === 'Space' && isSpacebarDown.current) {
            isSpacebarDown.current = false;
            canvas.setCursor(canvas.defaultCursor);
            canvas.selection = true;
            canvas.requestRenderAll();
        }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);

    return {
        cleanup: () => {
            window.removeEventListener('keydown', handleGlobalKeyDown);
            window.removeEventListener('keyup', handleGlobalKeyUp);
        },
        type: 'window',
    };
}

// --- RESIZE EVENT HANDLER ---

/**
 * Registers a ResizeObserver for container resize events.
 * Resizes the canvas element to match container, then fits the document within it.
 * Document dimensions are tracked separately in useCanvasStore.
 */
export function registerResizeEventHandler(
    canvas: fabric.Canvas,
    container: HTMLElement,
    onViewportChange?: (canvas: fabric.Canvas) => void
): EventHandlerCleanup {
    const handleResize = () => {
        const { width, height } = container.getBoundingClientRect();
        if (width > 0 && height > 0) {
            // Resize canvas element to match container
            canvas.setDimensions({ width, height });
            canvas.calcOffset();

            // Fit the document to the viewport using stored document dimensions
            fitCanvasToViewport(width, height);

            updateGuides(canvas, useEditorStore.getState().showGuides);
            canvas.requestRenderAll();
            onViewportChange?.(canvas);
        }
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Also fit to viewport on initial load
    frameScheduler.scheduleTask(() => {
        const { width, height } = container.getBoundingClientRect();
        if (width > 0 && height > 0) {
            // Resize canvas element to match container
            canvas.setDimensions({ width, height });
            canvas.calcOffset();

            fitCanvasToViewport(width, height);
        }
    }, TaskPriority.Normal);

    return {
        cleanup: () => {
            resizeObserver.unobserve(container);
            resizeObserver.disconnect();
        },
        type: 'observer',
    };
}

// --- SMART GUIDES HANDLER ---

/**
 * Initializes smart guides (snapping/grid) for the canvas.
 */
export function registerSmartGuidesHandler(
    canvas: fabric.Canvas,
    config?: { snapEnabled?: boolean; gridEnabled?: boolean }
): EventHandlerCleanup {
    const cleanupSmartGuides = initSmartGuides(canvas, {
        snapEnabled: config?.snapEnabled ?? false,
        gridEnabled: config?.gridEnabled ?? false,
    });

    return {
        cleanup: cleanupSmartGuides,
        type: 'custom',
    };
}

// --- COMPOSITE HANDLER REGISTRATION ---

/**
 * Event handler registry that tracks all registered handlers.
 */
export class CanvasEventRegistry {
    private handlers: EventHandlerCleanup[] = [];

    register(handler: EventHandlerCleanup): void {
        this.handlers.push(handler);
    }

    cleanupAll(): void {
        this.handlers.forEach((handler) => {
            try {
                handler.cleanup();
            } catch (error) {
                console.error(`[CanvasEventRegistry] Cleanup error for ${handler.type}:`, error);
            }
        });
        this.handlers = [];
    }

    getHandlerCount(): number {
        return this.handlers.length;
    }

    getHandlersByType(type: EventHandlerCleanup['type']): EventHandlerCleanup[] {
        return this.handlers.filter((h) => h.type === type);
    }
}

/**
 * Registers ALL canvas event handlers at once.
 * Returns a registry with cleanup function.
 */
export function registerAllCanvasEventHandlers(
    options: CanvasEventHandlerOptions & {
        container: HTMLElement;
    }
): CanvasEventRegistry {
    const { canvas } = options;
    const registry = new CanvasEventRegistry();

    // Register all handler groups
    registry.register(registerObjectEventHandlers(options));
    registry.register(registerSelectionEventHandlers(options));
    registry.register(registerViewportEventHandlers(options));
    registry.register(registerPanEventHandlers(options));
    registry.register(registerKeyboardEventHandlers(options));
    registry.register(registerSmartGuidesHandler(canvas, options.config));

    // Initialize guides
    updateGuides(canvas, useEditorStore.getState().showGuides);

    // Force initial render to ensure canvas is visible immediately
    canvas.requestRenderAll();

    return registry;
}
