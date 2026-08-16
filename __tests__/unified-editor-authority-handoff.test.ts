import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  createProjectLifecycleAuthority,
  type ProjectLifecycleAuthority,
} from '../src/editor/session/projectLifecycleAuthority';
import { PROJECT_CHANGE_DIAGNOSTIC_COVERAGE } from '../src/editor/session/projectChangeDiagnostic';
import { useEditorStore } from '../src/editor/state/editorStore';
import {
  createBlankDocumentProject,
  useDocumentStore,
} from '../src/document/state/documentStore';

const projectChange = (
  coordinator: ReturnType<typeof createProjectChangeCoordinator>,
  projectId = 'project-a'
) => coordinator.observeCommitted({
  projectId,
  source: 'canvas',
  action: 'modify-freeform-style',
  pageIds: ['page-1'],
  domains: ['style'],
  target: { kind: 'freeform-object', id: 'object-1' },
  assetEffect: 'none',
});

const createAdapter = (overrides: Partial<{
  save: (name?: string) => Promise<boolean>;
  autosave: () => Promise<boolean>;
  canSave: () => boolean;
  canAutosave: () => boolean;
  autosaveDelayMs: number;
}> = {}) => ({
  canSave: () => true,
  canAutosave: () => true,
  autosaveDelayMs: 100,
  save: async () => true,
  autosave: async () => true,
  ...overrides,
});

const activeAuthorities: ProjectLifecycleAuthority[] = [];
const originalCanvasState = useEditorStore.getState();
const originalDocumentState = useDocumentStore.getState();

afterEach(() => {
  activeAuthorities.splice(0).forEach((authority) => authority.dispose());
  useEditorStore.setState(originalCanvasState, true);
  useDocumentStore.setState(originalDocumentState, true);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const createRuntime = () => {
  const coordinator = createProjectChangeCoordinator();
  const authority = createProjectLifecycleAuthority({ coordinator });
  activeAuthorities.push(authority);
  return { coordinator, authority };
};

describe('Unified Editor shared authority handoff', () => {
  it('starts clean and advances only for committed active-project authored transactions', () => {
    const coordinator = createProjectChangeCoordinator();
    const subscribe = vi.spyOn(coordinator, 'subscribe');
    const authority = createProjectLifecycleAuthority({ coordinator });
    activeAuthorities.push(authority);
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter(),
    });

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 0,
      persistedRevision: 0,
      isDirty: false,
      saveStatus: 'saved',
    });

    projectChange(coordinator);
    projectChange(coordinator, 'project-b');
    const rejected = coordinator.begin({
      projectId: 'project-a',
      source: 'canvas',
      action: 'modify-freeform-style',
      pageIds: ['page-1'],
      domains: ['style'],
      target: { kind: 'freeform-object', id: 'object-1' },
      assetEffect: 'none',
    });
    coordinator.reject(rejected, { code: 'invalid-target', message: 'stale' });
    const failed = coordinator.begin({
      projectId: 'project-a',
      source: 'canvas',
      action: 'modify-freeform-style',
      pageIds: ['page-1'],
      domains: ['style'],
      target: { kind: 'freeform-object', id: 'object-1' },
      assetEffect: 'none',
    });
    coordinator.fail(failed, { code: 'observer-error', message: 'failed' });

    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 1,
      persistedRevision: 0,
      isDirty: true,
      saveStatus: 'unsaved',
    });
  });

  it('coalesces a burst into one shared autosave and advances the watermark', async () => {
    vi.useFakeTimers();
    const autosave = vi.fn().mockResolvedValue(true);
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter({ autosave }),
    });

    projectChange(coordinator);
    projectChange(coordinator);
    projectChange(coordinator);
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 3,
      pendingAutosave: true,
      saveInFlight: false,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(autosave).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();

    expect(autosave).toHaveBeenCalledTimes(1);
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 3,
      persistedRevision: 3,
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('keeps newer edits dirty and schedules a follow-up after an older save completes', async () => {
    vi.useFakeTimers();
    let resolveAutosave: ((result: boolean) => void) | null = null;
    const autosave = vi.fn()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => {
        resolveAutosave = resolve;
      }))
      .mockResolvedValue(true);
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter({ autosave }),
    });

    projectChange(coordinator);
    await vi.advanceTimersByTimeAsync(100);
    expect(authority.getSnapshot()).toMatchObject({
      saveInFlight: true,
      saveInFlightRevision: 1,
      saveStatus: 'saving',
    });

    projectChange(coordinator);
    projectChange(coordinator);
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 3,
      persistedRevision: 0,
      isDirty: true,
    });

    resolveAutosave?.(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(authority.getSnapshot()).toMatchObject({
      persistedRevision: 1,
      authoredRevision: 3,
      isDirty: true,
      pendingAutosave: true,
    });

    await vi.advanceTimersByTimeAsync(100);
    await Promise.resolve();
    expect(autosave).toHaveBeenCalledTimes(2);
    expect(authority.getSnapshot()).toMatchObject({
      persistedRevision: 3,
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('keeps dirty state on save failure and manual save coalesces pending work', async () => {
    vi.useFakeTimers();
    const autosave = vi.fn().mockResolvedValue(true);
    const save = vi.fn().mockResolvedValue(false);
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter({ autosave, save }),
    });
    projectChange(coordinator);

    const manualResult = await authority.save('Manual project');
    expect(manualResult).toBe(false);
    expect(autosave).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('Manual project');
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 1,
      persistedRevision: 0,
      isDirty: true,
      saveStatus: 'error',
    });
  });

  it('keeps an edit made during manual save dirty for the next save', async () => {
    let resolveSave: ((result: boolean) => void) | null = null;
    const save = vi.fn().mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveSave = resolve;
      })
    );
    const autosave = vi.fn().mockResolvedValue(true);
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter({ save, autosave }),
    });

    projectChange(coordinator);
    const manualSave = authority.save();
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 1,
      saveInFlightRevision: 1,
      saveStatus: 'saving',
    });

    projectChange(coordinator);
    resolveSave?.(true);
    await manualSave;

    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 2,
      persistedRevision: 1,
      isDirty: true,
      saveStatus: 'unsaved',
      pendingAutosave: true,
    });
    expect(autosave).not.toHaveBeenCalled();
  });

  it('does not schedule autosave for a non-persisted session', async () => {
    vi.useFakeTimers();
    const autosave = vi.fn().mockResolvedValue(true);
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'canvas-session-a',
      adapter: createAdapter({ autosave, canAutosave: () => false }),
    });

    projectChange(coordinator);
    await vi.advanceTimersByTimeAsync(500);

    expect(autosave).not.toHaveBeenCalled();
    expect(authority.getSnapshot()).toMatchObject({
      authoredRevision: 1,
      persistedRevision: 0,
      isDirty: true,
      autosaveEligible: false,
      pendingAutosave: false,
    });
  });

  it('keeps authority coverage separate from future engine authority claims', () => {
    expect(PROJECT_CHANGE_DIAGNOSTIC_COVERAGE).toMatchObject({
      sharedDirtyAuthority: true,
      sharedAutosaveAuthority: true,
      sharedHistoryAuthority: false,
      sharedPersistenceAuthority: false,
      sharedRecoveryAuthority: false,
      sharedAssetAuthority: false,
      completeAuthoredCoverage: true,
    });
  });

  it('ignores stale save completion after a project/session replacement', async () => {
    let resolveAutosave: ((result: boolean) => void) | null = null;
    const autosave = vi.fn().mockImplementation(
      () => new Promise<boolean>((resolve) => {
        resolveAutosave = resolve;
      })
    );
    const { coordinator, authority } = createRuntime();
    authority.startSession({
      projectId: 'project-a',
      sessionIdentity: 'session-a',
      adapter: createAdapter({ autosave }),
    });
    projectChange(coordinator);

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(100);
    authority.startSession({
      projectId: 'project-b',
      sessionIdentity: 'session-b',
      adapter: createAdapter({ autosave }),
    });
    resolveAutosave?.(true);
    await Promise.resolve();

    expect(authority.getSnapshot()).toMatchObject({
      projectId: 'project-b',
      sessionIdentity: 'session-b',
      generation: 2,
      authoredRevision: 0,
      persistedRevision: 0,
      isDirty: false,
      saveStatus: 'saved',
    });
  });

  it('guards both legacy renderer autosave timers in shared mode', async () => {
    vi.useFakeTimers();
    const canvasUpdate = vi.fn().mockResolvedValue(undefined);
    useEditorStore.setState({
      lifecycleAuthorityMode: 'shared',
      currentLibraryProjectId: 'canvas-library-id',
      autoSaveTimer: null,
      updateCurrentProject: canvasUpdate,
    });
    useEditorStore.getState().triggerAutoSave();

    const documentFlush = vi.fn().mockResolvedValue(true);
    useDocumentStore.setState({
      project: createBlankDocumentProject('Shared mode document'),
      currentLibraryProjectId: 'document-library-id',
      lifecycleAuthorityMode: 'shared',
      isDirty: false,
      flushAutosave: documentFlush,
    });
    useDocumentStore.getState().updateDocumentLanguage('fr');

    await vi.advanceTimersByTimeAsync(2500);
    expect(canvasUpdate).not.toHaveBeenCalled();
    expect(documentFlush).not.toHaveBeenCalled();
  });
});
