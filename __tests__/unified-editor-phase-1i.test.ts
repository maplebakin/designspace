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

const flowImageObservation = (
  action: 'add-structured-flow-image' | 'remove-structured-flow-image',
  flowImageId: string,
  assetEffect: 'retained-reference' | 'cleanup-delegated'
) => ({
  projectId: 'flow-image-project',
  source: 'document' as const,
  action,
  pageIds: ['document-page'],
  domains: ['structured-content'] as const,
  target: { kind: 'structured-image' as const, id: flowImageId },
  assetEffect,
});

describe('Unified Editor Phase 1I flow-image lifecycle diagnostics', () => {
  it('normalizes insertion and removal as separate structured-content actions', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('flow-image-project'));

    observeCommittedEngineChange(
      coordinator,
      flowImageObservation(
        'add-structured-flow-image',
        'flow-image-1',
        'retained-reference'
      )
    );
    observeCommittedEngineChange(
      coordinator,
      flowImageObservation(
        'remove-structured-flow-image',
        'flow-image-1',
        'cleanup-delegated'
      )
    );

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 2,
      committedTransactionCount: 2,
      lastCommittedTransaction: expect.objectContaining({
        action: 'remove-structured-flow-image',
        pageIds: ['document-page'],
        domains: ['structured-content', 'asset-reference'],
        target: { kind: 'structured-image', id: 'flow-image-1' },
        assetEffect: 'cleanup-delegated',
      }),
      coverage: {
        documentFlowImageAdd: true,
        documentFlowImageRemove: true,
        completeAuthoredCoverage: true,
      },
    });

    observer.dispose();
    coordinator.dispose();
  });

  it('keeps rejected flow-image commands out of diagnostic authored revision', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('flow-image-project'));

    const handle = coordinator.begin(flowImageObservation(
      'remove-structured-flow-image',
      'stale-flow-image',
      'cleanup-delegated'
    ));
    coordinator.reject(handle, {
      code: 'target-not-found',
      message: 'The flow image no longer exists.',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 0,
      committedTransactionCount: 0,
      rejectedTransactionCount: 1,
      lastOutcome: {
        status: 'rejected',
        action: 'remove-structured-flow-image',
      },
    });

    observer.dispose();
    coordinator.dispose();
  });
});
