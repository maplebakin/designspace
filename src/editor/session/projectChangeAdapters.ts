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
  ProjectChangeObservation,
  ProjectChangeSource,
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

const safely = <T>(operation: () => T): T | undefined => {
  try {
    return operation();
  } catch {
    // Observability must not turn a successful legacy mutation into a failed
    // product command. The legacy result remains authoritative.
    return undefined;
  }
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

  const handle = safely(() => coordinator.begin(
    createPageObservation(source, command)
  ));

  try {
    const result = await execute(command);
    if (!handle) return result;

    const completion = completionFromResult(result);
    if (result.ok) {
      safely(() => coordinator.complete(handle, completion));
    } else if (result.status === 'rejected') {
      safely(() => coordinator.reject(handle, result.error, completion));
    } else {
      safely(() => coordinator.fail(handle, result.error, completion));
    }
    return result;
  } catch (error) {
    if (handle) {
      safely(() => coordinator.fail(handle, {
        code: 'engine-error',
        message: error instanceof Error ? error.message : 'Page mutation failed.',
      }));
    }
    throw error;
  }
};

export const observeCommittedEngineChange = (
  coordinator: ProjectChangeCoordinator,
  observation: ProjectChangeObservation,
  completion?: ProjectChangeCompletion
) => safely(() => coordinator.observeCommitted(observation, completion));
