import { useRef, useCallback } from 'react';
import * as fabric from 'fabric';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { resolveThemeValue } from '../utils/themeResolver';

/**
 * Custom hook for atomic canvas lifecycle management.
 * Ensures:
 * 1. Canvas is created
 * 2. All event handlers are registered
 * 3. Layer sync handler is registered
 * 4. Canvas is set in store (atomic operation)
 * 5. Initial sync is triggered (safe now)
 */
// Global WeakMap to track canvas elements that are being/have been initialized
// This prevents double initialization across component re-renders
const initializationTracker = new WeakMap<HTMLCanvasElement, boolean>();

export const useCanvasLifecycle = (
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  containerRef: React.RefObject<HTMLDivElement | null>
) => {
  const isInitializingRef = useRef(false);
  const cleanupAbortControllerRef = useRef<AbortController | null>(null);
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const hasInitializedRef = useRef(false);

  const {
    setCanvas,
    setCanvasReadyState,
    setLayerSyncHandler,
    acquireSyncLock,
    releaseSyncLock,
  } = useEditorStore((state) => ({
    setCanvas: state.setCanvas,
    setCanvasReadyState: state.setCanvasReadyState,
    setLayerSyncHandler: state.setLayerSyncHandler,
    acquireSyncLock: state.acquireSyncLock,
    releaseSyncLock: state.releaseSyncLock,
  }));
  const { canvasBackgroundColor, themeData } = useThemeStore((state) => ({
    canvasBackgroundColor: state.canvasBackgroundColor,
    themeData: state.themeData,
  }));


  const initializeCanvas = useCallback(async (
    setupHandlers: (canvas: fabric.Canvas, abortSignal: AbortSignal) => (() => void) | null
  ) => {
    // Prevent concurrent initialization
    if (isInitializingRef.current) {
      return null;
    }

    // Check if this component has already initialized
    if (hasInitializedRef.current) {
      return null;
    }

    // Wait for any pending cleanup
    if (cleanupPromiseRef.current) {
      await cleanupPromiseRef.current;
      cleanupPromiseRef.current = null;
    }

    if (!canvasRef.current || !containerRef.current) {
      return null;
    }

    // Check if the canvas element has already been initialized by another instance
    const canvasElement = canvasRef.current;
    if (initializationTracker.get(canvasElement)) {
      console.warn('[useCanvasLifecycle] Canvas element already tracked as initialized, skipping');
      return null;
    }

    // Mark as initializing BEFORE any async operations
    isInitializingRef.current = true;
    hasInitializedRef.current = true;
    initializationTracker.set(canvasElement, true);

    setCanvasReadyState('initializing');

    // PHASE 2.2: Acquire sync lock during initialization
    acquireSyncLock('init');

    try {
      const canvasElement = canvasRef.current;

      // CRITICAL: Check if canvas element already has a Fabric.js instance
      // This prevents double initialization (common in React StrictMode)
      if ((canvasElement as any).__fabric) {
        console.warn('[useCanvasLifecycle] Canvas element already has Fabric.js instance, disposing and cleaning up');
        try {
          // Dispose existing instance
          const existingCanvas = (canvasElement as any).__fabric;
          if (existingCanvas && typeof existingCanvas.dispose === 'function') {
            existingCanvas.dispose();
          }

          // Clear the __fabric reference
          delete (canvasElement as any).__fabric;

          // AGGRESSIVE CLEANUP: Unwrap canvas from Fabric.js container
          // Fabric.js wraps the canvas in a div.canvas-container
          const parent = canvasElement.parentElement;
          if (parent && parent.classList.contains('canvas-container')) {
            const grandparent = parent.parentElement;
            if (grandparent) {
              // Move canvas back to grandparent, removing the wrapper
              grandparent.appendChild(canvasElement);
              grandparent.removeChild(parent);
            }
          }

          // Remove all Fabric.js specific attributes and properties
          canvasElement.removeAttribute('data-fabric');
          canvasElement.style.cssText = canvasElement.className.includes('bg-white')
            ? canvasElement.style.cssText
            : '';

          // Clean up any sibling canvas elements Fabric might have created
          const container = canvasElement.parentElement;
          if (container) {
            const siblings = Array.from(container.children);
            siblings.forEach((sibling) => {
              if (
                sibling !== canvasElement &&
                sibling.tagName === 'CANVAS' &&
                (sibling.classList.contains('lower-canvas') ||
                 sibling.classList.contains('upper-canvas'))
              ) {
                container.removeChild(sibling);
              }
            });
          }

          // Force a small delay to ensure cleanup is complete
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          console.error('[useCanvasLifecycle] Error during canvas cleanup:', error);
        }
      }

      // Re-check after potential cleanup
      const finalCanvasElement = canvasRef.current;
      if (!finalCanvasElement) {
        throw new Error('Canvas element is null after cleanup');
      }

      // Get container dimensions for canvas element size
      // Document dimensions are tracked separately in useCanvasStore (initialized to DEFAULT_CANVAS_SIZE)
      const container = containerRef.current;
      const containerRect = container?.getBoundingClientRect();
      const width = containerRect?.width ?? 800;
      const height = containerRect?.height ?? 600;

      // Step 1: Create Fabric.js canvas instance at container size
      const canvas = new fabric.Canvas(finalCanvasElement, {
        width,
        height,
        backgroundColor:
          canvasBackgroundColor
          || resolveThemeValue(themeData, 'surfaces.page-background')
          || DEFAULT_CANVAS_BACKGROUND,
        selection: true,
        controlsAboveOverlay: true,
        stopContextMenu: true,
      });

      canvas.calcOffset();

      // Step 2-4: Register ALL event handlers (via callback)
      // This includes layer sync handler registration
      const abortController = new AbortController();
      cleanupAbortControllerRef.current = abortController;

      const cleanupHandlers = setupHandlers(canvas, abortController.signal);

      if (abortController.signal.aborted) {
        // Aborted during setup
        canvas.dispose();
        isInitializingRef.current = false;
        return null;
      }

      // Step 5: Set canvas in store (atomic operation)
      // At this point, all handlers are registered
      setCanvas(canvas);

      // Step 5.5: Force initial render to make canvas visible
      // This ensures objects are displayed immediately after initialization
      canvas.requestRenderAll();

      // Step 6: Mark as ready
      setCanvasReadyState('ready');

      isInitializingRef.current = false;

      return {
        canvas,
        cleanup: cleanupHandlers,
        abortController,
      };
    } catch (error) {
      console.error('[useCanvasLifecycle] Initialization failed:', error);

      // Clean up __fabric reference if initialization failed
      if (canvasRef.current && (canvasRef.current as any).__fabric) {
        try {
          const failedCanvas = (canvasRef.current as any).__fabric;
          if (failedCanvas && typeof failedCanvas.dispose === 'function') {
            failedCanvas.dispose();
          }
          delete (canvasRef.current as any).__fabric;
        } catch (cleanupError) {
          console.error('[useCanvasLifecycle] Cleanup after failed init:', cleanupError);
        }
      }

      // Clear initialization tracking flags since init failed
      if (canvasRef.current) {
        initializationTracker.delete(canvasRef.current);
      }
      hasInitializedRef.current = false;

      setCanvasReadyState('disposed');
      isInitializingRef.current = false;
      return null;
    } finally {
      // PHASE 2.2: Always release sync lock after initialization
      releaseSyncLock();
    }
  }, [
    canvasRef,
    containerRef,
    canvasBackgroundColor,
    themeData,
    setCanvas,
    setCanvasReadyState,
    acquireSyncLock,
    releaseSyncLock,
  ]);

  const disposeCanvas = useCallback(async (
    canvas: fabric.Canvas | null,
    cleanupHandlers: (() => void) | null,
    abortController: AbortController | null
  ) => {
    if (!canvas) return;


    // Step 1: Set state to disposing
    setCanvasReadyState('disposing');

    // Step 2: Signal cancellation
    if (abortController) {
      abortController.abort();
    }

    // Step 3: Remove sync handler first
    setLayerSyncHandler(null);

    // Step 4: Run cleanup handlers (removes event listeners, RAF callbacks)
    if (cleanupHandlers) {
      cleanupHandlers();
    }

    // Step 5: Dispose Fabric canvas (only if not already disposed)
    const finalizeDisposal = async () => {
      try {
        // Check if canvas is still valid before disposing
        if (canvas && typeof canvas.dispose === 'function') {
          await Promise.resolve(canvas.dispose());
        }

        // Additional cleanup: ensure __fabric reference is cleared from canvas element
        if (canvasRef.current && (canvasRef.current as any).__fabric) {
          delete (canvasRef.current as any).__fabric;
        }

        // Clear initialization tracking flags to allow re-initialization
        if (canvasRef.current) {
          initializationTracker.delete(canvasRef.current);
        }
        hasInitializedRef.current = false;
        isInitializingRef.current = false;
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : '';
        if (!message.includes('aborted')) {
          console.error('[useCanvasLifecycle] Disposal error:', error);
        }
      }

      // Step 6: Clear canvas from store
      setCanvas(null);

      // Step 7: Mark as disposed
      setCanvasReadyState('disposed');
    };

    // Store cleanup promise
    const cleanupPromise = finalizeDisposal();
    cleanupPromiseRef.current = cleanupPromise;

    await cleanupPromise;
    cleanupPromiseRef.current = null;
  }, [setCanvas, setCanvasReadyState, setLayerSyncHandler]);

  return {
    initializeCanvas,
    disposeCanvas,
    isInitializing: () => isInitializingRef.current,
    getAbortController: () => cleanupAbortControllerRef.current,
  };
};
