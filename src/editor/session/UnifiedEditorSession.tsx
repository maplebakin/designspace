import React, { useCallback, useEffect } from 'react';
import { PageViewport } from './PageViewport';
import {
  legacyRendererAdapters,
  useLegacyProjectSessionBridge,
} from './legacyRendererAdapters';
import type { SelectionEvent } from './projectSession';
import { useProjectSessionStore } from '../state/projectSessionStore';

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
  const {
    mode,
    snapshot,
    commands,
    zoom,
  } = useLegacyProjectSessionBridge();
  const adapter = legacyRendererAdapters[mode];
  const LegacyRenderer = adapter.render;

  useEffect(() => {
    if (!snapshot) return;
    setSessionSnapshot(snapshot, commands);
  }, [commands, setSessionSnapshot, snapshot]);

  const handleSelectionEvent = useCallback(
    (event: SelectionEvent) => reportSelection(event),
    [reportSelection]
  );

  return (
    <PageViewport
      session={snapshot}
      zoom={zoom}
      onViewportChange={setViewport}
    >
      <LegacyRenderer
        onBackToDashboard={onBackToDashboard}
        onSelectionEvent={handleSelectionEvent}
      />
    </PageViewport>
  );
};
