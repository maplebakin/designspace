import type {
  ProjectChangeCoordinator,
  ProjectChangeTransaction,
} from './projectChangeCoordinator';
import type { SessionSaveStatus } from './projectSession';
import { recordDocumentTypingLatencyCounter } from '../../document/services/documentTypingLatencyDiagnostics';

export type ProjectLifecycleSaveAdapter = Readonly<{
  canSave: () => boolean;
  canAutosave: () => boolean;
  autosaveDelayMs: number;
  save: (name?: string) => Promise<boolean>;
  autosave: () => Promise<boolean>;
}>;

export type ProjectLifecycleSnapshot = Readonly<{
  projectId: string | null;
  sessionIdentity: string | null;
  generation: number;
  authoredRevision: number;
  persistedRevision: number;
  saveInFlightRevision: number | null;
  isDirty: boolean;
  saveStatus: SessionSaveStatus;
  autosaveEligible: boolean;
  pendingAutosave: boolean;
  /** Runtime evidence for browser coverage; reset for each active session. */
  autosaveInvocationCount: number;
  saveInFlight: boolean;
  canSave: boolean;
  canClose: boolean;
}>;

/**
 * The lifecycle fields that affect shared editor chrome. Authored and
 * persisted watermarks remain available from getSnapshot(), but changing a
 * watermark alone does not require every React subscriber to render again.
 */
export type ProjectLifecyclePresentationSnapshot = Readonly<{
  projectId: string | null;
  sessionIdentity: string | null;
  generation: number;
  isDirty: boolean;
  saveStatus: SessionSaveStatus;
  autosaveEligible: boolean;
  pendingAutosave: boolean;
  autosaveInvocationCount: number;
  saveInFlight: boolean;
  canSave: boolean;
  canClose: boolean;
}>;

export type ProjectLifecycleAuthority = Readonly<{
  getSnapshot: () => ProjectLifecycleSnapshot;
  subscribe: (listener: () => void) => () => void;
  getPresentationSnapshot: () => ProjectLifecyclePresentationSnapshot;
  subscribePresentation: (listener: () => void) => () => void;
  startSession: (options: {
    projectId: string;
    sessionIdentity: string;
    adapter: ProjectLifecycleSaveAdapter;
  }) => void;
  endSession: () => void;
  save: (name?: string) => Promise<boolean>;
  markPersistedRevision: (revision: number) => void;
  dispose: () => void;
}>;

export type ProjectLifecycleAuthorityOptions = Readonly<{
  coordinator: ProjectChangeCoordinator;
}>;

type ActiveSession = {
  projectId: string;
  sessionIdentity: string;
  generation: number;
  adapter: ProjectLifecycleSaveAdapter;
};

type InFlightSave = {
  generation: number;
  revision: number;
  promise: Promise<boolean>;
};

const EMPTY_SNAPSHOT: ProjectLifecycleSnapshot = Object.freeze({
  projectId: null,
  sessionIdentity: null,
  generation: 0,
  authoredRevision: 0,
  persistedRevision: 0,
  saveInFlightRevision: null,
  isDirty: false,
  saveStatus: 'saved',
  autosaveEligible: false,
  pendingAutosave: false,
  autosaveInvocationCount: 0,
  saveInFlight: false,
  canSave: false,
  canClose: true,
});

const EMPTY_PRESENTATION_SNAPSHOT: ProjectLifecyclePresentationSnapshot = Object.freeze({
  projectId: null,
  sessionIdentity: null,
  generation: 0,
  isDirty: false,
  saveStatus: 'saved',
  autosaveEligible: false,
  pendingAutosave: false,
  autosaveInvocationCount: 0,
  saveInFlight: false,
  canSave: false,
  canClose: true,
});

const safeCapability = (read: () => boolean) => {
  try {
    return read();
  } catch {
    return false;
  }
};

/**
 * Runtime-only lifecycle authority for a unified editor session.
 *
 * ProjectChange is the only authored-revision input. Renderer adapters remain
 * responsible for serialization and writing; this module owns only lifecycle
 * state, revision watermarks, and the one shared autosave schedule.
 */
export const createProjectLifecycleAuthority = (
  options: ProjectLifecycleAuthorityOptions
): ProjectLifecycleAuthority => {
  const listeners = new Set<() => void>();
  const presentationListeners = new Set<() => void>();
  let snapshot = EMPTY_SNAPSHOT;
  let presentationSnapshot = EMPTY_PRESENTATION_SNAPSHOT;
  let activeSession: ActiveSession | null = null;
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlightSave: InFlightSave | null = null;
  let disposed = false;

  const notifyExact = () => {
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Exact lifecycle subscribers are observational and cannot affect
        // editing.
      }
    });
  };

  const notifyPresentation = () => {
    recordDocumentTypingLatencyCounter('lifecycleUiNotifications');
    presentationListeners.forEach((listener) => {
      try {
        recordDocumentTypingLatencyCounter('lifecycleSubscriberInvocations');
        listener();
      } catch {
        // Presentation subscribers are observational and cannot affect
        // editing.
      }
    });
  };

  const updatePresentationSnapshot = (next: ProjectLifecycleSnapshot) => {
    const changed = (
      presentationSnapshot.projectId !== next.projectId
      || presentationSnapshot.sessionIdentity !== next.sessionIdentity
      || presentationSnapshot.generation !== next.generation
      || presentationSnapshot.isDirty !== next.isDirty
      || presentationSnapshot.saveStatus !== next.saveStatus
      || presentationSnapshot.autosaveEligible !== next.autosaveEligible
      || presentationSnapshot.pendingAutosave !== next.pendingAutosave
      || presentationSnapshot.autosaveInvocationCount !== next.autosaveInvocationCount
      || presentationSnapshot.saveInFlight !== next.saveInFlight
      || presentationSnapshot.canSave !== next.canSave
      || presentationSnapshot.canClose !== next.canClose
    );
    presentationSnapshot = Object.freeze({
      projectId: next.projectId,
      sessionIdentity: next.sessionIdentity,
      generation: next.generation,
      isDirty: next.isDirty,
      saveStatus: next.saveStatus,
      autosaveEligible: next.autosaveEligible,
      pendingAutosave: next.pendingAutosave,
      autosaveInvocationCount: next.autosaveInvocationCount,
      saveInFlight: next.saveInFlight,
      canSave: next.canSave,
      canClose: next.canClose,
    });
    if (changed) notifyPresentation();
  };

  const setSnapshot = (
    next: Omit<ProjectLifecycleSnapshot, 'isDirty' | 'saveInFlight' | 'canSave' | 'canClose'>
  ) => {
    const isDirty = next.authoredRevision > next.persistedRevision;
    const saveInFlight = next.saveInFlightRevision !== null;
    const canSave = activeSession
      ? safeCapability(activeSession.adapter.canSave)
      : false;
    snapshot = Object.freeze({
      ...next,
      isDirty,
      saveInFlight,
      canSave,
      canClose: true,
    });
    updatePresentationSnapshot(snapshot);
    notifyExact();
  };

  const isCurrentGeneration = (generation: number) => (
    !disposed
    && activeSession?.generation === generation
  );

  const cancelAutosave = () => {
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
    }
    if (snapshot.pendingAutosave) {
      setSnapshot({
        ...snapshot,
        pendingAutosave: false,
      });
    }
  };

  const scheduleAutosave = (generation: number) => {
    const session = activeSession;
    if (
      !session
      || session.generation !== generation
      || !safeCapability(session.adapter.canAutosave)
      || snapshot.authoredRevision <= snapshot.persistedRevision
      || inFlightSave?.generation === generation
    ) {
      return;
    }

    const delay = Number.isFinite(session.adapter.autosaveDelayMs)
      ? Math.max(0, session.adapter.autosaveDelayMs)
      : 0;
    if (autosaveTimer !== null) {
      clearTimeout(autosaveTimer);
    }
    if (!snapshot.pendingAutosave) {
      setSnapshot({
        ...snapshot,
        autosaveEligible: true,
        pendingAutosave: true,
      });
    }
    autosaveTimer = setTimeout(() => {
      autosaveTimer = null;
      if (!isCurrentGeneration(generation)) return;
      setSnapshot({
        ...snapshot,
        pendingAutosave: false,
      });
      void runSave('autosave', undefined, generation);
    }, delay);
  };

  const completeSuccessfulSave = (generation: number, revision: number) => {
    if (!isCurrentGeneration(generation)) return;
    const persistedRevision = Math.max(snapshot.persistedRevision, revision);
    const newerChanges = snapshot.authoredRevision > persistedRevision;
    const adapter = activeSession?.adapter;
    setSnapshot({
      ...snapshot,
      persistedRevision,
      saveInFlightRevision: null,
      saveStatus: newerChanges ? 'unsaved' : 'saved',
      autosaveEligible: adapter
        ? safeCapability(adapter.canAutosave)
        : false,
      pendingAutosave: false,
    });
    if (newerChanges) scheduleAutosave(generation);
  };

  const completeFailedSave = (generation: number) => {
    if (!isCurrentGeneration(generation)) return;
    const adapter = activeSession?.adapter;
    setSnapshot({
      ...snapshot,
      saveInFlightRevision: null,
      saveStatus: 'error',
      autosaveEligible: adapter
        ? safeCapability(adapter.canAutosave)
        : false,
      pendingAutosave: false,
    });
  };

  const runSave = (
    kind: 'manual' | 'autosave',
    name: string | undefined,
    generation: number
  ): Promise<boolean> => {
    const session = activeSession;
    if (!session || session.generation !== generation) return Promise.resolve(false);
    if (inFlightSave?.generation === generation) return inFlightSave.promise;
    if (kind === 'autosave' && !safeCapability(session.adapter.canAutosave)) {
      return Promise.resolve(false);
    }
    if (kind === 'manual' && !safeCapability(session.adapter.canSave)) {
      return Promise.resolve(false);
    }

    cancelAutosave();
    const revision = snapshot.authoredRevision;
    setSnapshot({
      ...snapshot,
      saveStatus: 'saving',
      saveInFlightRevision: revision,
      pendingAutosave: false,
      autosaveInvocationCount: kind === 'autosave'
        ? snapshot.autosaveInvocationCount + 1
        : snapshot.autosaveInvocationCount,
    });

    const promise = (async () => {
      let succeeded = false;
      try {
        succeeded = kind === 'manual'
          ? await session.adapter.save(name)
          : await session.adapter.autosave();
      } catch {
        succeeded = false;
      }

      if (isCurrentGeneration(generation)) {
        if (inFlightSave?.generation === generation) {
          inFlightSave = null;
        }
        if (succeeded) completeSuccessfulSave(generation, revision);
        else completeFailedSave(generation);
      }
      return succeeded;
    })();
    inFlightSave = { generation, revision, promise };
    void promise.finally(() => {
      if (inFlightSave?.promise === promise) inFlightSave = null;
    });
    return promise;
  };

  const handleCommittedTransaction = (transaction: ProjectChangeTransaction) => {
    if (
      disposed
      || transaction.status !== 'committed'
      || !activeSession
      || transaction.projectId !== activeSession.projectId
    ) {
      return;
    }
    setSnapshot({
      ...snapshot,
      projectId: activeSession.projectId,
      sessionIdentity: activeSession.sessionIdentity,
      generation: activeSession.generation,
      authoredRevision: snapshot.authoredRevision + 1,
      saveInFlightRevision: snapshot.saveInFlightRevision,
      saveStatus: 'unsaved',
      autosaveEligible: safeCapability(activeSession.adapter.canAutosave),
      pendingAutosave: (
        safeCapability(activeSession.adapter.canAutosave)
        && inFlightSave?.generation !== activeSession.generation
      )
        ? true
        : snapshot.pendingAutosave,
    });
    scheduleAutosave(activeSession.generation);
  };

  const unsubscribeCoordinator = options.coordinator.subscribe(
    handleCommittedTransaction
  );

  const startSession = ({ projectId, sessionIdentity, adapter }: {
    projectId: string;
    sessionIdentity: string;
    adapter: ProjectLifecycleSaveAdapter;
  }) => {
    if (disposed) return;
    if (
      activeSession
      && activeSession.sessionIdentity === sessionIdentity
    ) {
      activeSession = {
        ...activeSession,
        projectId,
        adapter,
      };
      setSnapshot({
        ...snapshot,
        projectId,
        sessionIdentity,
        autosaveEligible: safeCapability(adapter.canAutosave),
      });
      return;
    }

    cancelAutosave();
    const generation = snapshot.generation + 1;
    activeSession = { projectId, sessionIdentity, generation, adapter };
    inFlightSave = null;
    setSnapshot({
      projectId,
      sessionIdentity,
      generation,
      authoredRevision: 0,
      persistedRevision: 0,
      saveInFlightRevision: null,
      saveStatus: 'saved',
      autosaveEligible: safeCapability(adapter.canAutosave),
      pendingAutosave: false,
      autosaveInvocationCount: 0,
    });
  };

  const endSession = () => {
    if (disposed && !activeSession) return;
    cancelAutosave();
    activeSession = null;
    inFlightSave = null;
    setSnapshot({
      ...EMPTY_SNAPSHOT,
      generation: snapshot.generation + 1,
    });
  };

  const save = async (name?: string) => {
    const session = activeSession;
    if (!session || !safeCapability(session.adapter.canSave)) return false;

    cancelAutosave();
    const pending = inFlightSave?.generation === session.generation
      ? inFlightSave
      : null;
    if (pending) {
      const pendingResult = await pending.promise;
      if (!isCurrentGeneration(session.generation)) return false;
      if (
        pendingResult
        && snapshot.authoredRevision <= snapshot.persistedRevision
      ) {
        return true;
      }
      cancelAutosave();
    }

    return runSave('manual', name, session.generation);
  };

  const markPersistedRevision = (revision: number) => {
    if (!activeSession || !Number.isFinite(revision)) return;
    const persistedRevision = Math.max(
      snapshot.persistedRevision,
      Math.min(Math.trunc(revision), snapshot.authoredRevision)
    );
    const newerChanges = snapshot.authoredRevision > persistedRevision;
    cancelAutosave();
    setSnapshot({
      ...snapshot,
      persistedRevision,
      saveStatus: newerChanges ? 'unsaved' : 'saved',
      autosaveEligible: safeCapability(activeSession.adapter.canAutosave),
      pendingAutosave: false,
    });
    if (newerChanges) scheduleAutosave(activeSession.generation);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getPresentationSnapshot: () => presentationSnapshot,
    subscribePresentation: (listener) => {
      presentationListeners.add(listener);
      return () => presentationListeners.delete(listener);
    },
    startSession,
    endSession,
    save,
    markPersistedRevision,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      unsubscribeCoordinator();
      cancelAutosave();
      activeSession = null;
      inFlightSave = null;
      listeners.clear();
      presentationListeners.clear();
    },
  };
};
