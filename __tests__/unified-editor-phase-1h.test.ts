import { describe, expect, it } from 'vitest';
import {
  createProjectChangeDiagnosticObserver,
} from '../src/editor/session/projectChangeDiagnostic';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  observeCommittedEngineChange,
} from '../src/editor/session/projectChangeAdapters';

const cleanLifecycle = (projectId: string) => ({
  projectId,
  legacyDirty: false,
  legacySaveStatus: 'saved' as const,
});

const overlayObservation = (
  action: 'add-structured-overlay' | 'remove-structured-overlay',
  assetEffect: 'retained-reference' | 'cleanup-delegated'
) => ({
  projectId: 'overlay-lifecycle-project',
  source: 'document' as const,
  action,
  pageIds: ['document-page'],
  domains: ['structured-content'] as const,
  target: { kind: 'structured-image' as const, id: 'overlay-1' },
  assetEffect,
});

describe('Unified Editor Phase 1H overlay lifecycle diagnostics', () => {
  it('normalizes add/remove as structured content with separate asset effects', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('overlay-lifecycle-project'));

    observeCommittedEngineChange(
      coordinator,
      overlayObservation('add-structured-overlay', 'retained-reference')
    );
    observeCommittedEngineChange(
      coordinator,
      overlayObservation('remove-structured-overlay', 'cleanup-delegated')
    );

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 2,
      committedTransactionCount: 2,
      lastCommittedTransaction: expect.objectContaining({
        action: 'remove-structured-overlay',
        domains: ['structured-content', 'asset-reference'],
        target: { kind: 'structured-image', id: 'overlay-1' },
        assetEffect: 'cleanup-delegated',
      }),
      coverage: {
        documentOverlayAdd: true,
        documentOverlayRemove: true,
        completeAuthoredCoverage: true,
      },
    });
    expect(observer.view.getSnapshot().legacyDirty).toBe(false);

    observer.dispose();
    coordinator.dispose();
  });

  it('does not advance diagnostic revision for rejected lifecycle commands', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('overlay-lifecycle-project'));

    const handle = coordinator.begin(
      overlayObservation('remove-structured-overlay', 'cleanup-delegated')
    );
    coordinator.reject(handle, {
      code: 'page-not-found',
      message: 'The overlay page no longer exists.',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      committedTransactionCount: 0,
      rejectedTransactionCount: 1,
      lastOutcome: { status: 'rejected' },
    });

    observer.dispose();
    coordinator.dispose();
  });
});
