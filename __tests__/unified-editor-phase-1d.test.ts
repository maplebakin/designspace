import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  registerObjectEventHandlers,
} from '../src/editor/services/canvasEventService';
import {
  executeCanvasPageMutation,
  executeDocumentPageMutation,
} from '../src/editor/session/legacyPageMutationAdapters';
import {
  executeObservedPageMutation,
  observeCommittedEngineChange,
} from '../src/editor/session/projectChangeAdapters';
import {
  createProjectChangeCoordinator,
  type ProjectChangeTransaction,
} from '../src/editor/session/projectChangeCoordinator';
import { useDocumentStore } from '../src/document/state/documentStore';
import { useEditorStore, type ProjectPage } from '../src/editor/state/editorStore';

const originalCanvasState = useEditorStore.getState();

const canvasPage = (id: string): ProjectPage => ({
  id,
  name: id,
  canvasSize: { width: 1200, height: 900 },
  canvasData: { objects: [] },
});

const pageObservation = {
  projectId: 'observation-project',
  source: 'document' as const,
  action: 'modify-structured-geometry' as const,
  pageIds: ['page-1'],
  domains: ['geometry'] as const,
  target: {
    kind: 'structured-image' as const,
    id: 'overlay-1',
  },
  assetEffect: 'none' as const,
};

afterEach(() => {
  useDocumentStore.getState().reset();
  useEditorStore.setState(originalCanvasState, true);
});

describe('Unified Editor Phase 1D ProjectChangeCoordinator', () => {
  it('correlates one Canvas page command into one committed transaction', async () => {
    const first = canvasPage('canvas-page-1');
    useEditorStore.setState({
      currentLibraryProjectId: 'canvas-change-project',
      productProjectFields: null,
      pages: [first],
      activePageIndex: 0,
      addPage: vi.fn(async () => {
        useEditorStore.setState((state) => ({
          pages: [...state.pages, canvasPage('canvas-page-2')],
          activePageIndex: state.pages.length,
        }));
      }),
      switchToPage: vi.fn(async (index: number) => {
        useEditorStore.setState({ activePageIndex: index });
      }),
    });

    const coordinator = createProjectChangeCoordinator({
      now: (() => {
        let timestamp = 100;
        return () => timestamp++;
      })(),
      createTransactionId: () => 'tx-canvas-add',
    });
    const events: string[] = [];
    const transactions: ProjectChangeTransaction[] = [];
    coordinator.subscribeEvents((event) => events.push(event.phase));
    coordinator.subscribe((transaction) => transactions.push(transaction));

    const selection = await executeObservedPageMutation({
      command: {
        kind: 'select-page',
        projectId: 'canvas-change-project',
        pageId: 'canvas-page-1',
      },
      source: 'canvas',
      coordinator,
      execute: executeCanvasPageMutation,
    });
    expect(selection.ok).toBe(true);
    expect(transactions).toHaveLength(0);

    const result = await executeObservedPageMutation({
      command: {
        kind: 'add-page',
        projectId: 'canvas-change-project',
      },
      source: 'canvas',
      coordinator,
      execute: executeCanvasPageMutation,
    });

    expect(result).toMatchObject({
      ok: true,
      createdPageId: 'canvas-page-2',
    });
    expect(events).toEqual(['begin', 'commit']);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      transactionId: 'tx-canvas-add',
      projectId: 'canvas-change-project',
      source: 'canvas',
      action: 'add-page',
      pageIds: ['canvas-page-2'],
      domains: ['page-structure'],
      assetEffect: 'none',
      status: 'committed',
    });
    expect(transactions[0]).not.toHaveProperty('snapshot');
    expect(transactions[0]).not.toHaveProperty('canvas');
  });

  it('reports unsupported and invalid page commands as rejected transactions', async () => {
    const first = canvasPage('canvas-page-1');
    useEditorStore.setState({
      currentLibraryProjectId: 'canvas-rejection-project',
      productProjectFields: null,
      pages: [first],
      activePageIndex: 0,
    });

    const coordinator = createProjectChangeCoordinator({
      createTransactionId: (() => {
        let index = 0;
        return () => `tx-rejection-${++index}`;
      })(),
    });
    const transactions: ProjectChangeTransaction[] = [];
    coordinator.subscribe((transaction) => transactions.push(transaction));

    const duplicate = await executeObservedPageMutation({
      command: {
        kind: 'duplicate-page',
        projectId: 'canvas-rejection-project',
        sourcePageId: first.id,
      },
      source: 'canvas',
      coordinator,
      execute: executeCanvasPageMutation,
    });
    const stale = await executeObservedPageMutation({
      command: {
        kind: 'remove-page',
        projectId: 'canvas-rejection-project',
        pageId: 'missing-page',
      },
      source: 'canvas',
      coordinator,
      execute: executeCanvasPageMutation,
    });

    expect(duplicate).toMatchObject({
      ok: false,
      status: 'rejected',
      error: { code: 'unsupported' },
    });
    expect(stale).toMatchObject({
      ok: false,
      status: 'rejected',
      error: { code: 'page-not-found' },
    });
    expect(transactions).toHaveLength(2);
    expect(transactions.map((transaction) => transaction.status)).toEqual([
      'rejected',
      'rejected',
    ]);
    expect(transactions.map((transaction) => transaction.error?.code)).toEqual([
      'unsupported',
      'page-not-found',
    ]);
  });

  it('reports Document page asset effects without taking ownership of them', async () => {
    const project = useDocumentStore.getState().createBlankProject('Document changes');
    const sourcePageId = project.pages[0].id;
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: () => 'tx-document-duplicate',
    });
    const transactions: ProjectChangeTransaction[] = [];
    coordinator.subscribe((transaction) => transactions.push(transaction));

    const result = await executeObservedPageMutation({
      command: {
        kind: 'duplicate-page',
        projectId: project.projectId,
        sourcePageId,
      },
      source: 'document',
      coordinator,
      execute: executeDocumentPageMutation,
    });

    expect(result).toMatchObject({
      ok: true,
      effects: { assetEffects: 'retained-reference' },
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      source: 'document',
      action: 'duplicate-page',
      assetEffect: 'retained-reference',
      domains: ['page-structure', 'asset-reference'],
      status: 'committed',
    });
  });

  it('emits committed Document add, reorder, and remove transactions by page ID', async () => {
    const project = useDocumentStore.getState().createBlankProject('Document page actions');
    const firstPageId = project.pages[0].id;
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: (() => {
        let index = 0;
        return () => `tx-document-page-${++index}`;
      })(),
    });
    const transactions: ProjectChangeTransaction[] = [];
    coordinator.subscribe((transaction) => transactions.push(transaction));

    const added = await executeObservedPageMutation({
      command: { kind: 'add-page', projectId: project.projectId },
      source: 'document',
      coordinator,
      execute: executeDocumentPageMutation,
    });
    const addedPageId = added.ok ? added.createdPageId : undefined;
    expect(addedPageId).toBeTruthy();

    const reordered = await executeObservedPageMutation({
      command: {
        kind: 'reorder-page',
        projectId: project.projectId,
        pageId: firstPageId,
        targetIndex: 1,
      },
      source: 'document',
      coordinator,
      execute: executeDocumentPageMutation,
    });
    expect(reordered.ok).toBe(true);

    const removed = await executeObservedPageMutation({
      command: {
        kind: 'remove-page',
        projectId: project.projectId,
        pageId: firstPageId,
      },
      source: 'document',
      coordinator,
      execute: executeDocumentPageMutation,
    });
    expect(removed).toMatchObject({
      ok: true,
      removedPageId: firstPageId,
    });
    expect(transactions.map((transaction) => transaction.action)).toEqual([
      'add-page',
      'reorder-page',
      'remove-page',
    ]);
    expect(transactions.every((transaction) => transaction.status === 'committed')).toBe(true);
    expect(transactions[0].pageIds).toEqual([addedPageId]);
    expect(transactions[2].pageIds).toEqual([firstPageId]);
  });

  it('observes representative Canvas and Document committed geometry events', () => {
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: (() => {
        let index = 0;
        return () => `tx-geometry-${++index}`;
      })(),
    });
    const transactions: ProjectChangeTransaction[] = [];
    coordinator.subscribe((transaction) => transactions.push(transaction));

    observeCommittedEngineChange(coordinator, {
      projectId: 'canvas-project',
      source: 'canvas',
      action: 'modify-freeform-geometry',
      pageIds: ['canvas-page'],
      domains: ['geometry'],
      target: { kind: 'freeform-object', id: 'fabric-object-1' },
      assetEffect: 'none',
    });
    observeCommittedEngineChange(coordinator, pageObservation);

    expect(transactions).toHaveLength(2);
    expect(transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: 'canvas',
        action: 'modify-freeform-geometry',
        target: { kind: 'freeform-object', id: 'fabric-object-1' },
      }),
      expect.objectContaining({
        source: 'document',
        action: 'modify-structured-geometry',
        target: { kind: 'structured-image', id: 'overlay-1' },
      }),
    ]));
  });

  it('does not change legacy dirty or revision state while observing', () => {
    useDocumentStore.getState().createBlankProject('Read-only observation');
    const before = useDocumentStore.getState();
    const coordinator = createProjectChangeCoordinator();

    coordinator.observeCommitted(pageObservation);

    expect(useDocumentStore.getState()).toMatchObject({
      isDirty: before.isDirty,
      saveStatus: before.saveStatus,
      revision: before.revision,
    });
  });

  it('keeps passive subscribers isolated and cleans up subscriptions', () => {
    const subscriberError = vi.fn();
    const coordinator = createProjectChangeCoordinator({
      createTransactionId: () => 'tx-subscriber',
      onSubscriberError: subscriberError,
    });
    const throwingSubscriber = vi.fn(() => {
      throw new Error('diagnostic subscriber failed');
    });
    const healthySubscriber = vi.fn();
    const eventSubscriber = vi.fn();
    coordinator.subscribe(throwingSubscriber);
    const unsubscribeHealthy = coordinator.subscribe(healthySubscriber);
    const unsubscribeEvents = coordinator.subscribeEvents(eventSubscriber);

    const first = coordinator.observeCommitted(pageObservation);
    expect(first?.status).toBe('committed');
    expect(throwingSubscriber).toHaveBeenCalledTimes(1);
    expect(healthySubscriber).toHaveBeenCalledTimes(1);
    expect(eventSubscriber).toHaveBeenCalledTimes(2);
    expect(subscriberError).toHaveBeenCalledWith(
      expect.any(Error),
      'transaction'
    );

    unsubscribeHealthy();
    unsubscribeEvents();
    coordinator.observeCommitted(pageObservation);
    expect(healthySubscriber).toHaveBeenCalledTimes(1);
    expect(eventSubscriber).toHaveBeenCalledTimes(2);

    coordinator.dispose();
    expect(coordinator.observeCommitted(pageObservation)).toBeNull();
    expect(throwingSubscriber).toHaveBeenCalledTimes(2);
  });
});

describe('Canvas committed event adapter boundary', () => {
  it('reports one object:modified geometry event and ignores cleanup after disposal', () => {
    const listeners = new Map<string, (event: { target?: Record<string, unknown> }) => void>();
    const canvas = {
      on: vi.fn((name: string, listener: (event: { target?: Record<string, unknown> }) => void) => {
        listeners.set(name, listener);
      }),
      off: vi.fn((name: string) => listeners.delete(name)),
      getObjects: vi.fn(() => []),
      remove: vi.fn(),
    };
    const onCommittedMutation = vi.fn();
    const registration = registerObjectEventHandlers({
      canvas: canvas as any,
      callbacks: { onCommittedMutation },
    });

    listeners.get('object:modified')?.({
      target: { id: 'fabric-object-1', type: 'rect' },
    });

    expect(onCommittedMutation).toHaveBeenCalledTimes(1);
    expect(onCommittedMutation).toHaveBeenCalledWith({
      action: 'modify-freeform-geometry',
      objectId: 'fabric-object-1',
    });
    registration.cleanup();
    expect(canvas.off).toHaveBeenCalledWith(
      'object:modified',
      expect.any(Function)
    );
  });
});
