import { describe, expect, it, vi } from 'vitest';
import {
  createProjectChangeDiagnosticObserver,
} from '../src/editor/session/projectChangeDiagnostic';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';

const canvasGeometryObservation = (projectId = 'diagnostic-project') => ({
  projectId,
  source: 'canvas' as const,
  action: 'modify-freeform-geometry' as const,
  pageIds: ['canvas-page'],
  domains: ['geometry'] as const,
  target: {
    kind: 'freeform-object' as const,
    id: 'fabric-object',
  },
  assetEffect: 'none' as const,
});

const documentGeometryObservation = (projectId = 'diagnostic-project') => ({
  projectId,
  source: 'document' as const,
  action: 'modify-structured-geometry' as const,
  pageIds: ['document-page'],
  domains: ['geometry'] as const,
  target: {
    kind: 'structured-image' as const,
    id: 'document-overlay',
  },
  assetEffect: 'none' as const,
});

const lifecycle = (
  projectId: string,
  legacyDirty = false,
  legacySaveStatus: 'saved' | 'unsaved' | 'saving' | 'error' = 'saved'
) => ({
  projectId,
  legacyDirty,
  legacySaveStatus,
});

describe('Unified Editor Phase 1E project change diagnostics', () => {
  it('increments the runtime authored revision only for committed transactions', () => {
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: (() => {
        let index = 0;
        return () => `diagnostic-tx-${++index}`;
      })(),
    });
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(lifecycle('diagnostic-project'));

    const initial = observer.view.getSnapshot();
    expect(initial).toMatchObject({
      projectId: 'diagnostic-project',
      observedRevision: 0,
      committedTransactionCount: 0,
      legacyDirty: false,
      legacySaveStatus: 'saved',
      lastLegacyCleanRevision: 0,
      comparison: { state: 'consistent-clean' },
    });

    coordinator.observeCommitted(canvasGeometryObservation());
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: expect.objectContaining({
        action: 'modify-freeform-geometry',
        status: 'committed',
      }),
      changedPageIds: ['canvas-page'],
      changedDomains: ['geometry'],
      comparison: { state: 'observed-change-while-legacy-clean' },
    });

    observer.observeSession(lifecycle('diagnostic-project', true, 'unsaved'));
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      changesSinceLegacyClean: 1,
      comparison: { state: 'consistent-observed-dirty' },
    });

    const rejectedHandle = coordinator.begin({
      ...canvasGeometryObservation(),
      action: 'remove-page',
    });
    coordinator.reject(rejectedHandle, {
      code: 'unsupported',
      message: 'Unsupported page action.',
    });
    const failedHandle = coordinator.begin({
      ...documentGeometryObservation(),
      projectId: 'diagnostic-project',
    });
    coordinator.fail(failedHandle, {
      code: 'engine-error',
      message: 'Engine failed.',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      rejectedTransactionCount: 1,
      failedTransactionCount: 1,
      lastOutcome: expect.objectContaining({ status: 'failed' }),
      lastCommittedTransaction: expect.objectContaining({
        action: 'modify-freeform-geometry',
      }),
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('summarizes both trusted geometry sources once and keeps coverage explicit', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(lifecycle('geometry-project'));

    coordinator.observeCommitted(canvasGeometryObservation('geometry-project'));
    coordinator.observeCommitted(documentGeometryObservation('geometry-project'));
    observer.observeSession(lifecycle('geometry-project', true, 'unsaved'));

    const snapshot = observer.view.getSnapshot();
    expect(snapshot).toMatchObject({
      observedRevision: 2,
      committedTransactionCount: 2,
      changedPageIds: ['canvas-page', 'document-page'],
      changedDomains: ['geometry'],
      coverage: {
        pageStructure: true,
        canvasGeometry: true,
        canvasObjectAdd: true,
        canvasObjectRemove: true,
        documentOverlayAdd: true,
        documentOverlayRemove: true,
        documentOverlayGeometry: true,
        documentOverlayGeometryInputs: ['pointer', 'keyboard', 'inspector'],
        documentPageMetadata: true,
        completeAuthoredCoverage: false,
      },
    });
    expect(snapshot.coverage.unobservedAuthoredChangeCategories).toEqual(
      expect.arrayContaining([
        'Tiptap text editing',
        'remaining Canvas style controls',
      ])
    );

    observer.dispose();
    coordinator.dispose();
  });

  it('records a clean baseline only from observed legacy clean/save checkpoints', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(lifecycle('save-round-trip'));

    coordinator.observeCommitted(canvasGeometryObservation('save-round-trip'));
    observer.observeSession(lifecycle('save-round-trip', true, 'unsaved'));
    expect(observer.view.getSnapshot().changesSinceLegacyClean).toBe(1);

    observer.observeSession(lifecycle('save-round-trip', true, 'saving'));
    expect(observer.view.getSnapshot().comparison.state).toBe('save-in-progress');

    observer.observeSession(lifecycle('save-round-trip', false, 'saved'));
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      lastLegacyCleanRevision: 1,
      changesSinceLegacyClean: 0,
      comparison: { state: 'consistent-clean' },
    });

    coordinator.observeCommitted(canvasGeometryObservation('save-round-trip'));
    observer.observeSession(lifecycle('save-round-trip', true, 'unsaved'));
    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 2,
      changesSinceLegacyClean: 1,
      comparison: { state: 'consistent-observed-dirty' },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('classifies legacy dirty state without a transaction as a coverage gap', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(lifecycle('unobserved-project'));
    observer.observeSession(lifecycle('unobserved-project', true, 'unsaved'));

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      legacyDirty: true,
      comparison: {
        state: 'legacy-dirty-with-unobserved-change',
      },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('resets on project switch, ignores stale project transactions, and disposes cleanly', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    const listener = vi.fn();
    observer.view.subscribe(listener);
    observer.observeSession(lifecycle('project-a'));
    coordinator.observeCommitted(canvasGeometryObservation('project-a'));
    observer.observeSession(lifecycle('project-a', true, 'unsaved'));

    observer.observeSession(lifecycle('project-b'));
    expect(observer.view.getSnapshot()).toMatchObject({
      projectId: 'project-b',
      observedRevision: 0,
      committedTransactionCount: 0,
      rejectedTransactionCount: 0,
      failedTransactionCount: 0,
      changedPageIds: [],
      lastCommittedTransaction: null,
      lastLegacyCleanRevision: 0,
      comparison: { state: 'consistent-clean' },
    });

    coordinator.observeCommitted(canvasGeometryObservation('project-a'));
    expect(observer.view.getSnapshot().observedRevision).toBe(0);
    coordinator.observeCommitted(canvasGeometryObservation('project-b'));
    expect(observer.view.getSnapshot().observedRevision).toBe(1);

    const notificationsBeforeDispose = listener.mock.calls.length;
    observer.dispose();
    coordinator.observeCommitted(canvasGeometryObservation('project-b'));
    expect(observer.view.getSnapshot().observedRevision).toBe(1);
    expect(listener).toHaveBeenCalledTimes(notificationsBeforeDispose);

    coordinator.dispose();
  });

  it('does not create revisions from lifecycle-only hydration/open observation', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });

    observer.observeSession(lifecycle('reopened-project'));
    observer.observeSession(lifecycle('reopened-project', false, 'saved'));

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      committedTransactionCount: 0,
      comparison: { state: 'consistent-clean' },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('isolates diagnostic view listeners from the coordinator and healthy listeners', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(lifecycle('listener-project'));
    const throwingListener = vi.fn(() => {
      throw new Error('view listener failed');
    });
    const healthyListener = vi.fn();
    observer.view.subscribe(throwingListener);
    observer.view.subscribe(healthyListener);

    expect(() => coordinator.observeCommitted(
      canvasGeometryObservation('listener-project')
    )).not.toThrow();
    expect(throwingListener).toHaveBeenCalledTimes(2);
    expect(healthyListener).toHaveBeenCalledTimes(2);
    expect(observer.view.getSnapshot().observedRevision).toBe(1);

    observer.dispose();
    coordinator.dispose();
  });
});
