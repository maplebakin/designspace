import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PageViewport } from './PageViewport';
import {
  legacyRendererAdapters,
  useLegacyProjectSessionBridge,
} from './legacyRendererAdapters';
import type { SelectionEvent } from './projectSession';
import { useProjectSessionStore } from '../state/projectSessionStore';
import { UnifiedEditorShell } from './UnifiedEditorChrome';

export type UnifiedEditorSessionProps = {
  onBackToDashboard?: () => void;
};

/**
 * One product-level route for both legacy renderer families. The selected
 * adapter owns the existing engine shell; this component owns only the
 * read-only session/page viewport observation boundary.
 */
export const UnifiedEditorSession: React.FC<UnifiedEditorSessionProps> = ({
  onBackToDashboard,
}) => {
  const reportSelection = useProjectSessionStore((state) => state.reportSelection);
  const setSessionSnapshot = useProjectSessionStore((state) => state.setSessionSnapshot);
  const setViewport = useProjectSessionStore((state) => state.setViewport);
  const clearSession = useProjectSessionStore((state) => state.clearSession);
  const {
    mode,
    snapshot,
    commands,
    zoom,
  } = useLegacyProjectSessionBridge();
  const adapter = legacyRendererAdapters[mode];
  const LegacyRenderer = adapter.render;
  const fitPageRef = useRef<(() => void) | null>(null);

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
        clearSession();
        onBackToDashboard?.();
      },
      fitPage: () => {
        if (commands.fitPage) {
          commands.fitPage();
          return;
        }
        fitPageRef.current?.();
      },
    };
  }, [clearSession, commands, onBackToDashboard]);

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
            useSharedChrome
            onRegisterFitPage={registerFitPage}
            sharedPageStrip={mode === 'canvas' ? canvasPageStrip : undefined}
          />
        </PageViewport>
      )}
    </UnifiedEditorShell>
  );
};
