import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PageViewport } from './PageViewport';
import {
  legacyRendererAdapters,
  useLegacyProjectSessionBridge,
} from './legacyRendererAdapters';
import type { SelectionEvent } from './projectSession';
import { useProjectSessionStore } from '../state/projectSessionStore';
import { UnifiedEditorShell } from './UnifiedEditorChrome';
import { createProjectChangeCoordinator } from './projectChangeCoordinator';
import {
  createProjectChangeDiagnosticObserver,
  type ProjectChangeDiagnosticObserver,
} from './projectChangeDiagnostic';

export type UnifiedEditorSessionProps = {
  onBackToDashboard?: () => void;
  /** Enables the runtime-only diagnostic shadow model without adding UI. */
  enableChangeDiagnostics?: boolean;
};

/**
 * One product-level route for both legacy renderer families. The selected
 * adapter owns the existing engine shell; this component owns only the
 * read-only session/page viewport observation boundary.
 */
export const UnifiedEditorSession: React.FC<UnifiedEditorSessionProps> = ({
  onBackToDashboard,
  enableChangeDiagnostics = false,
}) => {
  const changeCoordinator = useMemo(() => createProjectChangeCoordinator(), []);
  const diagnosticObserver = useMemo<ProjectChangeDiagnosticObserver | null>(
    () => enableChangeDiagnostics
      ? createProjectChangeDiagnosticObserver({ coordinator: changeCoordinator })
      : null,
    [changeCoordinator, enableChangeDiagnostics]
  );
  const reportSelection = useProjectSessionStore((state) => state.reportSelection);
  const setSessionSnapshot = useProjectSessionStore((state) => state.setSessionSnapshot);
  const setViewport = useProjectSessionStore((state) => state.setViewport);
  const clearSession = useProjectSessionStore((state) => state.clearSession);
  const {
    mode,
    snapshot,
    commands,
    zoom,
  } = useLegacyProjectSessionBridge(changeCoordinator);
  const adapter = legacyRendererAdapters[mode];
  const LegacyRenderer = adapter.render;
  const fitPageRef = useRef<(() => void) | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const runtimeLifecycleRef = useRef<{
    coordinator: typeof changeCoordinator;
    diagnosticObserver: ProjectChangeDiagnosticObserver | null;
    generation: number;
  } | null>(null);

  const handleSelectionEvent = useCallback(
    (event: SelectionEvent) => reportSelection(event),
    [reportSelection]
  );

  const registerFitPage = useCallback((fitPage: (() => void) | null) => {
    fitPageRef.current = fitPage;
  }, []);

  const sharedCommands = useMemo(() => {
    if (!commands) return null;
    return {
      ...commands,
      close: async () => {
        diagnosticObserver?.checkpoint('before-close');
        diagnosticObserver?.checkpoint('session-closed');
        diagnosticObserver?.dispose();
        changeCoordinator.dispose();
        clearSession();
        onBackToDashboard?.();
      },
      ...(diagnosticObserver
        ? { changeDiagnostic: diagnosticObserver.view }
        : {}),
      fitPage: () => {
        if (commands.fitPage) {
          commands.fitPage();
          return;
        }
        fitPageRef.current?.();
      },
    };
  }, [
    changeCoordinator,
    clearSession,
    commands,
    diagnosticObserver,
    onBackToDashboard,
  ]);

  useEffect(() => {
    const previousRuntime = runtimeLifecycleRef.current;
    if (previousRuntime?.coordinator !== changeCoordinator) {
      previousRuntime?.coordinator.dispose();
    }
    if (previousRuntime?.diagnosticObserver !== diagnosticObserver) {
      previousRuntime?.diagnosticObserver?.dispose();
    }
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;
    runtimeLifecycleRef.current = {
      coordinator: changeCoordinator,
      diagnosticObserver,
      generation,
    };
    return () => {
      // React StrictMode performs an immediate cleanup/setup probe. Defer
      // disposal one microtask so that probe does not kill the live runtime;
      // a real unmount has no newer generation and still disposes promptly.
      queueMicrotask(() => {
        if (runtimeLifecycleRef.current?.generation !== generation) return;
        diagnosticObserver?.checkpoint('session-closed');
        diagnosticObserver?.dispose();
        changeCoordinator.dispose();
        runtimeLifecycleRef.current = null;
      });
    };
  }, [changeCoordinator, diagnosticObserver]);

  useEffect(() => {
    if (!diagnosticObserver || !snapshot) return;
    diagnosticObserver.observeSession({
      projectId: snapshot.projectId,
      legacyDirty: snapshot.isDirty,
      legacySaveStatus: snapshot.saveStatus,
      legacyDirtyReason: snapshot.legacyDirtyReason,
    });
  }, [diagnosticObserver, snapshot]);

  useEffect(() => {
    if (!snapshot || !sharedCommands) return;
    setSessionSnapshot(snapshot, sharedCommands);
  }, [setSessionSnapshot, sharedCommands, snapshot]);

  return (
    <UnifiedEditorShell
      session={snapshot}
      commands={sharedCommands}
      zoom={zoom}
      onBackToDashboard={onBackToDashboard}
    >
      {({ canvasPageStrip }) => (
        <PageViewport
          session={snapshot}
          zoom={zoom}
          onViewportChange={setViewport}
        >
          <LegacyRenderer
            onSelectionEvent={handleSelectionEvent}
            changeCoordinator={changeCoordinator}
            useSharedChrome
            onRegisterFitPage={registerFitPage}
            sharedPageStrip={mode === 'canvas' ? canvasPageStrip : undefined}
          />
        </PageViewport>
      )}
    </UnifiedEditorShell>
  );
};
