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

describe('Unified Editor Phase 1J metadata fallback diagnostics', () => {
  it('normalizes one discrete page-orientation commit without owning dirty state', () => {
    const coordinator = createProjectChangeCoordinator();
    const observer = createProjectChangeDiagnosticObserver({ coordinator });
    observer.observeSession(cleanLifecycle('orientation-project'));

    observeCommittedEngineChange(coordinator, {
      projectId: 'orientation-project',
      source: 'document',
      action: 'modify-page-metadata',
      pageIds: ['document-page'],
      domains: ['page-structure'],
      target: { kind: 'page', id: 'document-page' },
      assetEffect: 'none',
    });

    expect(observer.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      legacyDirty: false,
      coverage: {
        documentPageMetadata: true,
        documentPageOrientation: true,
        completeAuthoredCoverage: false,
      },
      lastCommittedTransaction: expect.objectContaining({
        action: 'modify-page-metadata',
        pageIds: ['document-page'],
        target: { kind: 'page', id: 'document-page' },
      }),
    });

    observer.dispose();
    coordinator.dispose();
  });
});
