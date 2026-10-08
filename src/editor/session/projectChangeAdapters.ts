import type {
  PageMutationCommand,
  PageAssetEffect,
  PageMutationResult,
} from './projectMutation';
import type {
  ProjectChangeAction,
  ProjectChangeCompletion,
  ProjectChangeCoordinator,
  ProjectChangeDomain,
  ProjectChangeHandle,
  ProjectChangeObservation,
  ProjectChangeSource,
  ProjectChangeTransaction,
} from './projectChangeCoordinator';

type PageMutationExecutor = (
  command: PageMutationCommand
) => Promise<PageMutationResult>;

const getPageIdsForCommand = (
  command: Exclude<PageMutationCommand, { kind: 'select-page' }>
): readonly string[] => {
  switch (command.kind) {
    case 'add-page':
      return [];
    case 'duplicate-page':
      return [command.sourcePageId];
    case 'remove-page':
    case 'reorder-page':
      return [command.pageId];
  }
};

const isAuthoredPageMutation = (
  command: PageMutationCommand
): command is Exclude<PageMutationCommand, { kind: 'select-page' }> => (
  command.kind !== 'select-page'
);

export type ProjectChangeObservationFailureReason =
  'coordinator-error' | 'coordinator-not-active';

export type ProjectChangeObservationDelivery =
  | Readonly<{
      status: 'delivered';
      transaction: ProjectChangeTransaction;
    }>
  | Readonly<{
      status: 'not-delivered';
      reason: ProjectChangeObservationFailureReason;
      error?: unknown;
    }>;

const reportRequiredObservationFailure = (
  observation: ProjectChangeObservation,
  reason: ProjectChangeObservationFailureReason,
  error?: unknown,
) => {
  console.error(
    '[project-lifecycle] Required committed mutation observation was not delivered.',
    {
      projectId: observation.projectId,
      source: observation.source,
      action: observation.action,
      pageIds: observation.pageIds,
      reason,
      error,
    },
  );
};

const createPageObservation = (
  source: ProjectChangeSource,
  command: Exclude<PageMutationCommand, { kind: 'select-page' }>
): ProjectChangeObservation => ({
  projectId: command.projectId,
  source,
  action: command.kind as ProjectChangeAction,
  pageIds: getPageIdsForCommand(command),
  domains: ['page-structure'],
  assetEffect: 'none',
});

const completionFromResult = (
  result: PageMutationResult
): ProjectChangeCompletion => {
  if (!result.ok) {
    const assetEffect: PageAssetEffect = result.status === 'failed'
      ? 'unknown-engine-owned'
      : 'none';
    return {
      pageIds: result.affectedPageIds,
      domains: domainsForAssetEffectValue(assetEffect),
      assetEffect,
    };
  }
  const assetEffect = result.effects.assetEffects;
  return {
    pageIds: result.affectedPageIds,
    domains: domainsForAssetEffectValue(assetEffect),
    assetEffect,
  };
};

const domainsForAssetEffectValue = (
  assetEffect: PageAssetEffect
): readonly ProjectChangeDomain[] => assetEffect === 'none'
  ? ['page-structure']
  : ['page-structure', 'asset-reference'];

/**
 * Correlates one Phase 1C page command with exactly one terminal transaction.
 * Page selection is intentionally delegated without creating an authored
 * transaction because it is navigation/session state.
 */
export const executeObservedPageMutation = async ({
  command,
  source,
  coordinator,
  execute,
}: {
  command: PageMutationCommand;
  source: ProjectChangeSource;
  coordinator: ProjectChangeCoordinator;
  execute: PageMutationExecutor;
}): Promise<PageMutationResult> => {
  if (!isAuthoredPageMutation(command)) return execute(command);

  const observation = createPageObservation(source, command);
  let handle: ProjectChangeHandle | null = null;
  try {
    handle = coordinator.begin(observation);
  } catch (error) {
    reportRequiredObservationFailure(observation, 'coordinator-error', error);
  }

  try {
    const result = await execute(command);
    if (!handle) return result;

    const completion = completionFromResult(result);
    try {
      const transaction = result.ok
        ? coordinator.complete(handle, completion)
        : result.status === 'rejected'
          ? coordinator.reject(handle, result.error, completion)
          : coordinator.fail(handle, result.error, completion);
      if (!transaction) {
        reportRequiredObservationFailure(observation, 'coordinator-not-active');
      }
    } catch (error) {
      reportRequiredObservationFailure(observation, 'coordinator-error', error);
    }
    return result;
  } catch (error) {
    if (handle) {
      try {
        const transaction = coordinator.fail(handle, {
          code: 'engine-error',
          message: error instanceof Error ? error.message : 'Page mutation failed.',
        });
        if (!transaction) {
          reportRequiredObservationFailure(observation, 'coordinator-not-active');
        }
      } catch (observationError) {
        reportRequiredObservationFailure(observation, 'coordinator-error', observationError);
      }
    }
    throw error;
  }
};

export const observeCommittedEngineChange = (
  coordinator: ProjectChangeCoordinator,
  observation: ProjectChangeObservation,
  completion?: ProjectChangeCompletion
): ProjectChangeObservationDelivery => {
  try {
    const transaction = coordinator.observeCommitted(observation, completion);
    if (!transaction) {
      reportRequiredObservationFailure(observation, 'coordinator-not-active');
      return {
        status: 'not-delivered',
        reason: 'coordinator-not-active',
      };
    }
    return { status: 'delivered', transaction };
  } catch (error) {
    reportRequiredObservationFailure(observation, 'coordinator-error', error);
    return {
      status: 'not-delivered',
      reason: 'coordinator-error',
      error,
    };
  }
};
