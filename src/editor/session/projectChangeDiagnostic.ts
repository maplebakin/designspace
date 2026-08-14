import type {
  ProjectChangeCoordinator,
  ProjectChangeDomain,
  ProjectChangeTransaction,
} from './projectChangeCoordinator';

export type ProjectChangeDiagnosticSaveStatus =
  | 'saved'
  | 'unsaved'
  | 'saving'
  | 'error';

export type ProjectChangeDiagnosticLifecycle = Readonly<{
  projectId: string;
  legacyDirty: boolean;
  legacySaveStatus: ProjectChangeDiagnosticSaveStatus;
  /** Normalized legacy hint; it does not establish dirty ownership. */
  legacyDirtyReason?: 'authored-content' | 'navigation-persistence' | 'unknown' | null;
}>;

export type ProjectChangeDiagnosticLegacyDirtyReason =
  | 'observed-authored-change'
  | 'navigation-persistence'
  | 'unobserved-authored-change'
  | 'unknown';

export type ProjectChangeDiagnosticCheckpointKind =
  | 'session-opened'
  | 'after-authored-commit'
  | 'legacy-became-dirty'
  | 'save-started'
  | 'save-completed-clean'
  | 'save-failed'
  | 'before-close'
  | 'session-closed';

export type ProjectChangeDiagnosticCheckpoint = Readonly<{
  checkpointId: string;
  kind: ProjectChangeDiagnosticCheckpointKind;
  timestamp: number;
  projectId: string;
  observedRevision: number;
  legacyDirty: boolean | null;
  legacySaveStatus: ProjectChangeDiagnosticSaveStatus | null;
  legacyDirtyReason: ProjectChangeDiagnosticLegacyDirtyReason | null;
  lastCommittedTransactionId: string | null;
  comparison: ProjectChangeDiagnosticComparison;
  coverage: ProjectChangeDiagnosticCoverage;
}>;

export type ProjectChangeDiagnosticComparisonState =
  | 'consistent-clean'
  | 'consistent-observed-dirty'
  | 'legacy-dirty-with-navigation-persistence'
  | 'legacy-dirty-with-unobserved-change'
  | 'observed-change-while-legacy-clean'
  | 'save-in-progress'
  | 'insufficient-coverage'
  | 'unknown';

export type ProjectChangeDiagnosticComparison = Readonly<{
  state: ProjectChangeDiagnosticComparisonState;
  detail: string;
}>;

export type ProjectChangeDiagnosticDocumentGeometryInput =
  | 'pointer'
  | 'keyboard'
  | 'inspector';

export type ProjectChangeDiagnosticCoverage = Readonly<{
  pageStructure: true;
  canvasGeometry: true;
  canvasObjectAdd: true;
  canvasObjectRemove: true;
  /** Completed freehand strokes are observed through object:add. */
  canvasDrawing: true;
  /** The current erase tool does not produce semantic erase mutations. */
  canvasErase: false;
  canvasGrouping: true;
  canvasUngrouping: true;
  canvasBorderStyle: true;
  canvasTransformLock: true;
  documentOverlayAdd: true;
  documentOverlayRemove: true;
  documentFlowImageAdd: true;
  documentFlowImageRemove: true;
  documentOverlayGeometry: true;
  documentOverlayGeometryInputs: readonly ProjectChangeDiagnosticDocumentGeometryInput[];
  documentPageMetadata: true;
  documentPageOrientation: true;
  completeAuthoredCoverage: false;
  unobservedAuthoredChangeCategories: readonly string[];
}>;

export type ProjectChangeDiagnosticSnapshot = Readonly<{
  projectId: string | null;
  sessionStartedAt: number;
  observedRevision: number;
  committedTransactionCount: number;
  rejectedTransactionCount: number;
  failedTransactionCount: number;
  lastCommittedTransaction: ProjectChangeTransaction | null;
  lastOutcome: ProjectChangeTransaction | null;
  changedPageIds: readonly string[];
  changedDomains: readonly ProjectChangeDomain[];
  legacyDirty: boolean | null;
  legacySaveStatus: ProjectChangeDiagnosticSaveStatus | null;
  legacyDirtyReason: ProjectChangeDiagnosticLegacyDirtyReason | null;
  lastLegacyCleanRevision: number | null;
  changesSinceLegacyClean: number | null;
  comparison: ProjectChangeDiagnosticComparison;
  coverage: ProjectChangeDiagnosticCoverage;
  recentCheckpoints: readonly ProjectChangeDiagnosticCheckpoint[];
}>;

export type ProjectChangeDiagnosticListener = (
  snapshot: ProjectChangeDiagnosticSnapshot
) => void;

/**
 * Read-only access to the runtime shadow model. The observer/controller that
 * updates this view is intentionally not part of the public view contract.
 */
export type ProjectChangeDiagnosticView = Readonly<{
  getSnapshot: () => ProjectChangeDiagnosticSnapshot;
  subscribe: (listener: ProjectChangeDiagnosticListener) => () => void;
}>;

export type ProjectChangeDiagnosticObserver = Readonly<{
  view: ProjectChangeDiagnosticView;
  observeSession: (lifecycle: ProjectChangeDiagnosticLifecycle) => void;
  checkpoint: (kind: ProjectChangeDiagnosticCheckpointKind) => void;
  dispose: () => void;
}>;

export type ProjectChangeDiagnosticOptions = Readonly<{
  coordinator: ProjectChangeCoordinator;
  now?: () => number;
}>;

export const PROJECT_CHANGE_DIAGNOSTIC_COVERAGE: ProjectChangeDiagnosticCoverage = {
  pageStructure: true,
  canvasGeometry: true,
  canvasObjectAdd: true,
  canvasObjectRemove: true,
  canvasDrawing: true,
  canvasErase: false,
  canvasGrouping: true,
  canvasUngrouping: true,
  canvasBorderStyle: true,
  canvasTransformLock: true,
  documentOverlayAdd: true,
  documentOverlayRemove: true,
  documentFlowImageAdd: true,
  documentFlowImageRemove: true,
  documentOverlayGeometry: true,
  documentOverlayGeometryInputs: ['pointer', 'keyboard', 'inspector'],
  documentPageMetadata: true,
  documentPageOrientation: true,
  completeAuthoredCoverage: false,
  unobservedAuthoredChangeCategories: [
    'Tiptap text editing',
    'Fabric text editing',
    'remaining Canvas style controls',
    'Canvas text/style editing beyond Border Style',
    'Canvas Selection Lock and full-object lock',
    'other Canvas object metadata controls',
    'Document formatting/styles',
    'flow-image metadata and structured flow mutations',
    'captions, image groups, and references',
    'unobserved page settings, document styles, and page metadata beyond orientation and column count',
    'inspector metadata and asset mutations',
    'semantic Canvas eraser content changes (the current erase tool creates a regular PencilBrush path)',
    'templates, recipes, and full-page restoration',
  ],
};

const MAX_CHANGED_PAGE_IDS = 512;
const MAX_RECENT_CHECKPOINTS = 32;

const noOp = () => undefined;

const normalizeProjectId = (projectId: string) => {
  const normalized = projectId.trim();
  return normalized.length > 0 ? normalized : null;
};

const appendUniqueBounded = <T>(
  current: readonly T[],
  additions: readonly T[],
  maximum: number
): readonly T[] => {
  const result = [...current];
  additions.forEach((addition) => {
    if (!result.includes(addition) && result.length < maximum) {
      result.push(addition);
    }
  });
  return result;
};

const isCleanLifecycle = (
  lifecycle: ProjectChangeDiagnosticLifecycle
) => lifecycle.legacyDirty === false
  && lifecycle.legacySaveStatus === 'saved';

const deriveLegacyDirtyReason = (
  lifecycle: ProjectChangeDiagnosticLifecycle,
  changesSinceLegacyClean: number | null
): ProjectChangeDiagnosticLegacyDirtyReason | null => {
  if (!lifecycle.legacyDirty) return null;
  if (changesSinceLegacyClean !== null && changesSinceLegacyClean > 0) {
    return 'observed-authored-change';
  }
  if (lifecycle.legacyDirtyReason === 'navigation-persistence') {
    return 'navigation-persistence';
  }
  if (lifecycle.legacyDirtyReason === 'authored-content') {
    return 'unobserved-authored-change';
  }
  return 'unknown';
};

const deriveComparison = (
  snapshot: Omit<ProjectChangeDiagnosticSnapshot, 'comparison'>,
  observedChangeWhileLegacyClean: boolean
): ProjectChangeDiagnosticComparison => {
  if (
    !snapshot.projectId
    || snapshot.legacyDirty === null
    || snapshot.legacySaveStatus === null
  ) {
    return {
      state: 'unknown',
      detail: 'No complete project and legacy lifecycle observation is available.',
    };
  }

  if (snapshot.legacySaveStatus === 'saving') {
    return {
      state: 'save-in-progress',
      detail: 'Legacy save state is still in progress; comparison is provisional.',
    };
  }

  if (snapshot.legacySaveStatus === 'error') {
    return {
      state: 'unknown',
      detail: 'Legacy save state reports an error; the diagnostic view does not repair it.',
    };
  }

  if (snapshot.legacyDirty) {
    if ((snapshot.changesSinceLegacyClean ?? 0) > 0) {
      return {
        state: 'consistent-observed-dirty',
        detail: 'Legacy dirty state agrees with at least one committed observed transaction.',
      };
    }
    if (snapshot.legacyDirtyReason === 'navigation-persistence') {
      return {
        state: 'legacy-dirty-with-navigation-persistence',
        detail: 'Legacy dirty state reflects persisted active-page navigation; the transaction stream intentionally classifies page selection as non-authored session state.',
      };
    }
    if (snapshot.lastLegacyCleanRevision === null) {
      return {
        state: 'insufficient-coverage',
        detail: 'Legacy state is dirty, but no trustworthy clean baseline has been observed.',
      };
    }
    return {
      state: 'legacy-dirty-with-unobserved-change',
      detail: 'Legacy state is dirty without an observed transaction since the clean baseline; this may be an instrumentation gap.',
    };
  }

  if (snapshot.legacySaveStatus !== 'saved') {
    return {
      state: 'unknown',
      detail: 'Legacy dirty and save-status fields do not form a known clean or dirty checkpoint.',
    };
  }

  if (
    observedChangeWhileLegacyClean
    || (snapshot.changesSinceLegacyClean ?? 0) > 0
  ) {
    return {
      state: 'observed-change-while-legacy-clean',
      detail: 'A committed observed transaction arrived before legacy dirty state was visible; timing or lifecycle coverage may explain the difference.',
    };
  }

  if (snapshot.lastLegacyCleanRevision === null) {
    return {
      state: 'insufficient-coverage',
      detail: 'Legacy state is clean, but no trustworthy clean baseline has been observed.',
    };
  }

  return {
    state: 'consistent-clean',
    detail: 'Legacy clean state agrees with the observed diagnostic baseline.',
  };
};

const createSnapshot = ({
  projectId,
  sessionStartedAt,
  legacyDirty = null,
  legacySaveStatus = null,
  legacyDirtyReason = null,
}: {
  projectId: string | null;
  sessionStartedAt: number;
  legacyDirty?: boolean | null;
  legacySaveStatus?: ProjectChangeDiagnosticSaveStatus | null;
  legacyDirtyReason?: ProjectChangeDiagnosticLegacyDirtyReason | null;
}): ProjectChangeDiagnosticSnapshot => {
  const base: Omit<ProjectChangeDiagnosticSnapshot, 'comparison'> = {
    projectId,
    sessionStartedAt,
    observedRevision: 0,
    committedTransactionCount: 0,
    rejectedTransactionCount: 0,
    failedTransactionCount: 0,
    lastCommittedTransaction: null,
    lastOutcome: null,
    changedPageIds: [],
    changedDomains: [],
    legacyDirty,
    legacySaveStatus,
    legacyDirtyReason,
    lastLegacyCleanRevision: null,
    changesSinceLegacyClean: null,
    coverage: PROJECT_CHANGE_DIAGNOSTIC_COVERAGE,
    recentCheckpoints: [],
  };
  return {
    ...base,
    comparison: deriveComparison(base, false),
  };
};

/**
 * Creates an opt-in runtime shadow model over completed coordinator
 * transactions. It never calls a legacy store or persistence operation.
 */
export const createProjectChangeDiagnosticObserver = ({
  coordinator,
  now = () => Date.now(),
}: ProjectChangeDiagnosticOptions): ProjectChangeDiagnosticObserver => {
  let snapshot = createSnapshot({
    projectId: null,
    sessionStartedAt: now(),
  });
  let observedChangeWhileLegacyClean = false;
  let disposed = false;
  let checkpointSequence = 0;
  const listeners = new Set<ProjectChangeDiagnosticListener>();

  const publish = (
    nextBase: Omit<ProjectChangeDiagnosticSnapshot, 'comparison'>
  ) => {
    snapshot = {
      ...nextBase,
      comparison: deriveComparison(nextBase, observedChangeWhileLegacyClean),
    };
    listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // A diagnostic view listener is never allowed to affect the mutation path.
      }
    });
  };

  const recordCheckpoint = (
    kind: ProjectChangeDiagnosticCheckpointKind
  ) => {
    if (disposed || !snapshot.projectId) return;
    checkpointSequence += 1;
    const checkpoint: ProjectChangeDiagnosticCheckpoint = {
      checkpointId: `diagnostic-checkpoint-${checkpointSequence}`,
      kind,
      timestamp: now(),
      projectId: snapshot.projectId,
      observedRevision: snapshot.observedRevision,
      legacyDirty: snapshot.legacyDirty,
      legacySaveStatus: snapshot.legacySaveStatus,
      legacyDirtyReason: snapshot.legacyDirtyReason,
      lastCommittedTransactionId: snapshot.lastCommittedTransaction?.transactionId
        ?? null,
      comparison: snapshot.comparison,
      coverage: snapshot.coverage,
    };
    const recentCheckpoints = snapshot.recentCheckpoints.length
      >= MAX_RECENT_CHECKPOINTS
      ? [
          ...snapshot.recentCheckpoints.slice(1),
          checkpoint,
        ]
      : [...snapshot.recentCheckpoints, checkpoint];
    publish({
      ...snapshot,
      recentCheckpoints,
    });
  };

  const resetForProject = (
    projectId: string,
    lifecycle?: ProjectChangeDiagnosticLifecycle
  ) => {
    observedChangeWhileLegacyClean = false;
    const clean = lifecycle ? isCleanLifecycle(lifecycle) : false;
    const next = createSnapshot({
      projectId,
      sessionStartedAt: now(),
      legacyDirty: lifecycle?.legacyDirty ?? null,
      legacySaveStatus: lifecycle?.legacySaveStatus ?? null,
      legacyDirtyReason: lifecycle && lifecycle.legacyDirty
        ? lifecycle.legacyDirtyReason === 'navigation-persistence'
          ? 'navigation-persistence'
          : lifecycle.legacyDirtyReason === 'authored-content'
            ? 'unobserved-authored-change'
            : 'unknown'
        : null,
    });
    publish({
      ...next,
      lastLegacyCleanRevision: clean ? 0 : null,
      changesSinceLegacyClean: clean ? 0 : null,
    });
    recordCheckpoint('session-opened');
  };

  const observeSession = (lifecycle: ProjectChangeDiagnosticLifecycle) => {
    if (disposed) return;
    const projectId = normalizeProjectId(lifecycle.projectId);
    if (!projectId) return;
    if (snapshot.projectId && snapshot.projectId !== projectId) {
      resetForProject(projectId, lifecycle);
      return;
    }
    if (!snapshot.projectId) {
      resetForProject(projectId, lifecycle);
      return;
    }

    const previousDirty = snapshot.legacyDirty;
    const previousSaveStatus = snapshot.legacySaveStatus;
    let lastLegacyCleanRevision = snapshot.lastLegacyCleanRevision;
    const clean = isCleanLifecycle(lifecycle);
    const canAdvanceCleanBaseline = clean && (
      lastLegacyCleanRevision === null && snapshot.observedRevision === 0
      || previousDirty === true
      || previousSaveStatus === 'saving'
    );

    if (canAdvanceCleanBaseline) {
      lastLegacyCleanRevision = snapshot.observedRevision;
      observedChangeWhileLegacyClean = false;
    } else if (lifecycle.legacyDirty) {
      observedChangeWhileLegacyClean = false;
    }

    const changesSinceLegacyClean = lastLegacyCleanRevision === null
      ? null
      : Math.max(0, snapshot.observedRevision - lastLegacyCleanRevision);
    const base: Omit<ProjectChangeDiagnosticSnapshot, 'comparison'> = {
      ...snapshot,
      legacyDirty: lifecycle.legacyDirty,
      legacySaveStatus: lifecycle.legacySaveStatus,
      legacyDirtyReason: deriveLegacyDirtyReason(
        lifecycle,
        changesSinceLegacyClean
      ),
      lastLegacyCleanRevision,
      changesSinceLegacyClean,
    };
    publish(base);

    if (lifecycle.legacyDirty && previousDirty !== true) {
      recordCheckpoint('legacy-became-dirty');
    }
    if (lifecycle.legacySaveStatus === 'saving' && previousSaveStatus !== 'saving') {
      recordCheckpoint('save-started');
    }
    if (isCleanLifecycle(lifecycle) && (
      previousDirty === true || previousSaveStatus === 'saving'
    )) {
      recordCheckpoint('save-completed-clean');
    }
    if (lifecycle.legacySaveStatus === 'error' && previousSaveStatus !== 'error') {
      recordCheckpoint('save-failed');
    }
  };

  const handleTransaction = (transaction: ProjectChangeTransaction) => {
    if (disposed) return;
    if (!snapshot.projectId) {
      resetForProject(transaction.projectId);
    }
    if (snapshot.projectId !== transaction.projectId) return;

    const isCommitted = transaction.status === 'committed';
    if (
      isCommitted
      && snapshot.legacyDirty === false
      && snapshot.legacySaveStatus === 'saved'
    ) {
      observedChangeWhileLegacyClean = true;
    }

    const observedRevision = snapshot.observedRevision + (isCommitted ? 1 : 0);
    const lastLegacyCleanRevision = snapshot.lastLegacyCleanRevision;
    const nextBase: Omit<ProjectChangeDiagnosticSnapshot, 'comparison'> = {
      ...snapshot,
      observedRevision,
      committedTransactionCount: snapshot.committedTransactionCount
        + (isCommitted ? 1 : 0),
      rejectedTransactionCount: snapshot.rejectedTransactionCount
        + (transaction.status === 'rejected' ? 1 : 0),
      failedTransactionCount: snapshot.failedTransactionCount
        + (transaction.status === 'failed' ? 1 : 0),
      lastCommittedTransaction: isCommitted
        ? transaction
        : snapshot.lastCommittedTransaction,
      lastOutcome: transaction,
      changedPageIds: isCommitted
        ? appendUniqueBounded(
            snapshot.changedPageIds,
            transaction.pageIds,
            MAX_CHANGED_PAGE_IDS
          )
        : snapshot.changedPageIds,
      changedDomains: isCommitted
        ? appendUniqueBounded(snapshot.changedDomains, transaction.domains, 32)
        : snapshot.changedDomains,
      legacyDirtyReason: snapshot.legacyDirtyReason,
      lastLegacyCleanRevision,
      changesSinceLegacyClean: lastLegacyCleanRevision === null
        ? null
        : Math.max(0, observedRevision - lastLegacyCleanRevision),
    };
    publish(nextBase);
    if (isCommitted) recordCheckpoint('after-authored-commit');
  };

  const unsubscribeCoordinator = coordinator.subscribe(handleTransaction);

  const view: ProjectChangeDiagnosticView = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      if (disposed) return noOp;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    unsubscribeCoordinator();
    listeners.clear();
  };

  return {
    view,
    observeSession,
    checkpoint: recordCheckpoint,
    dispose,
  };
};
