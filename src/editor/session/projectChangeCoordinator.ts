import type {
  MutationErrorCode,
  PageAssetEffect,
} from './projectMutation';

/**
 * Product-level source of an authored change. These values describe the
 * legacy engine that performed the mutation; they do not expose that engine
 * to the shared coordinator.
 */
export type ProjectChangeSource = 'canvas' | 'document' | 'shared';

export type ProjectChangeDomain =
  | 'project-metadata'
  | 'page-structure'
  | 'structured-content'
  | 'freeform-content'
  | 'geometry'
  | 'style'
  | 'asset-reference';

/**
 * Actions currently observed by the unified shadow stream. This is deliberately small: a
 * future change can add a product action when it has a reliable committed
 * boundary instead of accepting arbitrary engine event names here.
 */
export type ProjectChangeAction =
  | 'add-page'
  | 'duplicate-page'
  | 'remove-page'
  | 'reorder-page'
  | 'rename-page'
  | 'add-freeform-object'
  | 'remove-freeform-object'
  | 'modify-freeform-geometry'
  | 'add-structured-overlay'
  | 'remove-structured-overlay'
  | 'modify-structured-geometry'
  | 'modify-page-metadata';

export type ProjectChangeTarget = Readonly<{
  kind: 'page' | 'freeform-object' | 'structured-image' | 'structured-group';
  id: string;
}>;

export type ProjectChangeError = Readonly<{
  code: MutationErrorCode | 'coordinator-error';
  message: string;
}>;

/**
 * Engine adapters provide this small description after a legacy mutation has
 * committed. It contains stable product IDs only and no engine snapshots.
 */
export type ProjectChangeObservation = Readonly<{
  projectId: string;
  source: ProjectChangeSource;
  action: ProjectChangeAction;
  pageIds: readonly string[];
  domains: readonly ProjectChangeDomain[];
  target?: ProjectChangeTarget;
  assetEffect?: PageAssetEffect;
  /** Optional runtime correlation supplied by a command caller. */
  correlationId?: string;
}>;

export type ProjectChangeTransaction = Readonly<{
  transactionId: string;
  projectId: string;
  source: ProjectChangeSource;
  action: ProjectChangeAction;
  pageIds: readonly string[];
  domains: readonly ProjectChangeDomain[];
  target?: ProjectChangeTarget;
  assetEffect: PageAssetEffect;
  startedAt: number;
  completedAt: number;
  status: 'committed' | 'rejected' | 'failed';
  error?: ProjectChangeError;
  correlationId?: string;
}>;

type ProjectChangeEventBase = Readonly<{
  transactionId: string;
  projectId: string;
  source: ProjectChangeSource;
  action: ProjectChangeAction;
  pageIds: readonly string[];
  domains: readonly ProjectChangeDomain[];
  target?: ProjectChangeTarget;
  assetEffect: PageAssetEffect;
  timestamp: number;
  correlationId?: string;
}>;

export type ProjectChangeEvent =
  | (ProjectChangeEventBase & { phase: 'begin' })
  | (ProjectChangeEventBase & {
      phase: 'commit' | 'reject' | 'fail';
      transaction: ProjectChangeTransaction;
    });

export type ProjectChangeHandle = Readonly<{
  transactionId: string;
  projectId: string;
  startedAt: number;
}>;

export type ProjectChangeCompletion = Readonly<{
  pageIds?: readonly string[];
  domains?: readonly ProjectChangeDomain[];
  target?: ProjectChangeTarget;
  assetEffect?: PageAssetEffect;
  completedAt?: number;
  correlationId?: string;
}>;

export type ProjectChangeCoordinatorOptions = Readonly<{
  now?: () => number;
  createTransactionId?: () => string;
  onSubscriberError?: (
    error: unknown,
    channel: 'event' | 'transaction'
  ) => void;
}>;

export type ProjectChangeEventListener = (event: ProjectChangeEvent) => void;
export type ProjectChangeTransactionListener = (
  transaction: ProjectChangeTransaction
) => void;

export type ProjectChangeCoordinator = Readonly<{
  begin: (observation: ProjectChangeObservation) => ProjectChangeHandle;
  complete: (
    handle: ProjectChangeHandle,
    completion?: ProjectChangeCompletion
  ) => ProjectChangeTransaction | null;
  reject: (
    handle: ProjectChangeHandle,
    error: ProjectChangeError,
    completion?: ProjectChangeCompletion
  ) => ProjectChangeTransaction | null;
  fail: (
    handle: ProjectChangeHandle,
    error: ProjectChangeError,
    completion?: ProjectChangeCompletion
  ) => ProjectChangeTransaction | null;
  /** Records a committed engine-native event at its reliable boundary. */
  observeCommitted: (
    observation: ProjectChangeObservation,
    completion?: ProjectChangeCompletion
  ) => ProjectChangeTransaction | null;
  /** Emits phase events, including begin and terminal events. */
  subscribeEvents: (listener: ProjectChangeEventListener) => () => void;
  /** Emits only completed/rejected/failed transactions. */
  subscribe: (listener: ProjectChangeTransactionListener) => () => void;
  dispose: () => void;
}>;

type ActiveChange = Readonly<{
  observation: ProjectChangeObservation;
  transactionId: string;
  startedAt: number;
}>;

const uniqueNonEmpty = (values: readonly string[]): readonly string[] => (
  Array.from(new Set(values.filter((value) => value.trim().length > 0)))
);

const uniqueDomains = (
  domains: readonly ProjectChangeDomain[],
  assetEffect: PageAssetEffect
): readonly ProjectChangeDomain[] => {
  const normalized = Array.from(new Set(domains));
  if (assetEffect !== 'none' && !normalized.includes('asset-reference')) {
    normalized.push('asset-reference');
  }
  return normalized;
};

const normalizeObservation = (
  observation: ProjectChangeObservation
): ProjectChangeObservation => {
  const assetEffect = observation.assetEffect ?? 'none';
  return {
    ...observation,
    pageIds: uniqueNonEmpty(observation.pageIds),
    domains: uniqueDomains(observation.domains, assetEffect),
    assetEffect,
  };
};

const defaultCreateTransactionId = (() => {
  let nextId = 0;
  return () => {
    nextId += 1;
    return `project-change-${Date.now()}-${nextId}`;
  };
})();

const noOp = () => undefined;

/**
 * Creates a runtime-only, read-only transaction coordinator. It stores only
 * transaction metadata while a mutation is in flight; it never stores engine
 * objects, project snapshots, or persistence state.
 */
export const createProjectChangeCoordinator = (
  options: ProjectChangeCoordinatorOptions = {}
): ProjectChangeCoordinator => {
  const now = options.now ?? (() => Date.now());
  const createTransactionId = options.createTransactionId
    ?? defaultCreateTransactionId;
  const onSubscriberError = options.onSubscriberError ?? noOp;
  const active = new Map<string, ActiveChange>();
  const eventListeners = new Set<ProjectChangeEventListener>();
  const transactionListeners = new Set<ProjectChangeTransactionListener>();
  let disposed = false;

  const reportSubscriberError = (
    error: unknown,
    channel: 'event' | 'transaction'
  ) => {
    try {
      onSubscriberError(error, channel);
    } catch {
      // Diagnostics must never become part of the editor mutation path.
    }
  };

  const notifyEvent = (event: ProjectChangeEvent) => {
    eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (error) {
        reportSubscriberError(error, 'event');
      }
    });
  };

  const notifyTransaction = (transaction: ProjectChangeTransaction) => {
    transactionListeners.forEach((listener) => {
      try {
        listener(transaction);
      } catch (error) {
        reportSubscriberError(error, 'transaction');
      }
    });
  };

  const begin = (rawObservation: ProjectChangeObservation): ProjectChangeHandle => {
    const observation = normalizeObservation(rawObservation);
    const transactionId = createTransactionId();
    const startedAt = now();
    const handle = { transactionId, projectId: observation.projectId, startedAt };

    if (disposed) return handle;

    active.set(transactionId, {
      observation,
      transactionId,
      startedAt,
    });
    notifyEvent({
      ...observation,
      transactionId,
      assetEffect: observation.assetEffect ?? 'none',
      timestamp: startedAt,
      phase: 'begin',
    });
    return handle;
  };

  const finish = (
    handle: ProjectChangeHandle,
    status: ProjectChangeTransaction['status'],
    error: ProjectChangeError | undefined,
    completion: ProjectChangeCompletion | undefined
  ): ProjectChangeTransaction | null => {
    const current = active.get(handle.transactionId);
    if (!current) return null;
    active.delete(handle.transactionId);

    const assetEffect = completion?.assetEffect
      ?? current.observation.assetEffect
      ?? 'none';
    const domains = uniqueDomains(
      completion?.domains ?? current.observation.domains,
      assetEffect
    );
    const completedAt = completion?.completedAt ?? now();
    const transaction: ProjectChangeTransaction = {
      transactionId: current.transactionId,
      projectId: current.observation.projectId,
      source: current.observation.source,
      action: current.observation.action,
      pageIds: uniqueNonEmpty(
        completion?.pageIds ?? current.observation.pageIds
      ),
      domains,
      ...(completion?.target ?? current.observation.target
        ? { target: completion?.target ?? current.observation.target }
        : {}),
      assetEffect,
      startedAt: current.startedAt,
      completedAt,
      status,
      ...(error ? { error } : {}),
      ...(completion?.correlationId ?? current.observation.correlationId
        ? {
            correlationId:
              completion?.correlationId ?? current.observation.correlationId,
          }
        : {}),
    };

    const phase = status === 'committed'
      ? 'commit'
      : status === 'rejected'
        ? 'reject'
        : 'fail';
    notifyEvent({
      transactionId: transaction.transactionId,
      projectId: transaction.projectId,
      source: transaction.source,
      action: transaction.action,
      pageIds: transaction.pageIds,
      domains: transaction.domains,
      ...(transaction.target ? { target: transaction.target } : {}),
      assetEffect: transaction.assetEffect,
      timestamp: completedAt,
      ...(transaction.correlationId
        ? { correlationId: transaction.correlationId }
        : {}),
      phase,
      transaction,
    });
    notifyTransaction(transaction);
    return transaction;
  };

  const complete = (
    handle: ProjectChangeHandle,
    completion?: ProjectChangeCompletion
  ) => finish(handle, 'committed', undefined, completion);

  const reject = (
    handle: ProjectChangeHandle,
    error: ProjectChangeError,
    completion?: ProjectChangeCompletion
  ) => finish(handle, 'rejected', error, completion);

  const fail = (
    handle: ProjectChangeHandle,
    error: ProjectChangeError,
    completion?: ProjectChangeCompletion
  ) => finish(handle, 'failed', error, completion);

  const observeCommitted = (
    observation: ProjectChangeObservation,
    completion?: ProjectChangeCompletion
  ) => {
    const handle = begin(observation);
    return complete(handle, completion);
  };

  const subscribeEvents = (listener: ProjectChangeEventListener) => {
    if (disposed) return noOp;
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  };

  const subscribe = (listener: ProjectChangeTransactionListener) => {
    if (disposed) return noOp;
    transactionListeners.add(listener);
    return () => transactionListeners.delete(listener);
  };

  const dispose = () => {
    disposed = true;
    active.clear();
    eventListeners.clear();
    transactionListeners.clear();
  };

  return {
    begin,
    complete,
    reject,
    fail,
    observeCommitted,
    subscribeEvents,
    subscribe,
    dispose,
  };
};
