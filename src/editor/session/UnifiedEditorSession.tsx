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
import { createProjectLifecycleAuthority } from './projectLifecycleAuthority';
import {
  createProjectChangeDiagnosticObserver,
  type ProjectChangeDiagnosticObserver,
} from './projectChangeDiagnostic';
import { flushDocumentLiveDrafts } from '../../document/services/documentLiveDraft';
import { recordDocumentTypingLatencyCounter } from '../../document/services/documentTypingLatencyDiagnostics';

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
  recordDocumentTypingLatencyCounter('unifiedSessionRenders');
  const changeCoordinator = useMemo(() => createProjectChangeCoordinator(), []);
  const lifecycleAuthority = useMemo(
    () => createProjectLifecycleAuthority({ coordinator: changeCoordinator }),
    [changeCoordinator]
  );
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
    lifecycleSnapshot,
    snapshot,
    commands,
    zoom,
    legacyLifecycle,
  } = useLegacyProjectSessionBridge(changeCoordinator, lifecycleAuthority);
  const adapter = legacyRendererAdapters[mode];
  const LegacyRenderer = adapter.render;
  const fitPageRef = useRef<(() => void) | null>(null);
  const lifecycleGenerationRef = useRef(0);
  const runtimeLifecycleRef = useRef<{
    coordinator: typeof changeCoordinator;
    lifecycleAuthority: typeof lifecycleAuthority;
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
        // Closing the shared session can unmount the document editor before
        // any idle draft timer fires. Flush the mounted ProseMirror draft
        // before ending the lifecycle session or clearing its route state.
        flushDocumentLiveDrafts();
        diagnosticObserver?.checkpoint('before-close');
        diagnosticObserver?.checkpoint('session-closed');
        lifecycleAuthority.endSession();
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
    lifecycleAuthority,
    onBackToDashboard,
  ]);

  useEffect(() => {
    const previousRuntime = runtimeLifecycleRef.current;
    if (
      previousRuntime?.coordinator !== changeCoordinator
      || previousRuntime?.lifecycleAuthority !== lifecycleAuthority
    ) {
      previousRuntime?.coordinator.dispose();
      previousRuntime?.lifecycleAuthority.dispose();
    }
    if (previousRuntime?.diagnosticObserver !== diagnosticObserver) {
      previousRuntime?.diagnosticObserver?.dispose();
    }
    const generation = lifecycleGenerationRef.current + 1;
    lifecycleGenerationRef.current = generation;
    runtimeLifecycleRef.current = {
      coordinator: changeCoordinator,
      lifecycleAuthority,
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
        lifecycleAuthority.dispose();
        runtimeLifecycleRef.current = null;
      });
    };
  }, [changeCoordinator, diagnosticObserver, lifecycleAuthority]);

  useEffect(() => {
    if (!diagnosticObserver || !snapshot) return;
    diagnosticObserver.observeSession({
      projectId: snapshot.projectId,
      legacyDirty: legacyLifecycle.isDirty,
      legacySaveStatus: legacyLifecycle.saveStatus,
      legacyDirtyReason: legacyLifecycle.legacyDirtyReason,
    });
  }, [diagnosticObserver, legacyLifecycle, snapshot]);

  useEffect(() => {
    if (!snapshot || !sharedCommands) return;
    setSessionSnapshot(snapshot, sharedCommands);
  }, [setSessionSnapshot, sharedCommands, snapshot]);

  // The exact authored watermark is a diagnostic/command value, not a
  // presentation value. Keep the existing header data attribute current
  // without subscribing React chrome to every authored transaction.
  useEffect(() => {
    const updateAuthoredRevisionAttribute = () => {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="unified-project-header"]'
      );
      if (!header) return;
      header.dataset.authoredRevision = String(
        lifecycleAuthority.getSnapshot().authoredRevision
      );
    };
    updateAuthoredRevisionAttribute();
    return lifecycleAuthority.subscribe(updateAuthoredRevisionAttribute);
  }, [lifecycleAuthority]);

  return (
    <UnifiedEditorShell
      session={snapshot}
      commands={sharedCommands}
      zoom={zoom}
      lifecycleDiagnostics={{
        authoredRevision: lifecycleAuthority.getSnapshot().authoredRevision,
        autosaveInvocationCount: lifecycleSnapshot.autosaveInvocationCount,
      }}
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
