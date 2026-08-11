/**
 * Product-level page mutation vocabulary.
 *
 * These commands deliberately use stable project/page IDs. Legacy adapters
 * may translate them to array indices at the engine boundary, but no shared
 * caller needs to know how either engine stores its pages.
 */
export type PageMutationCommand =
  | Readonly<{
      kind: 'select-page';
      projectId: string;
      pageId: string;
    }>
  | Readonly<{
      kind: 'add-page';
      projectId: string;
    }>
  | Readonly<{
      kind: 'duplicate-page';
      projectId: string;
      sourcePageId: string;
    }>
  | Readonly<{
      kind: 'remove-page';
      projectId: string;
      pageId: string;
    }>
  | Readonly<{
      kind: 'reorder-page';
      projectId: string;
      pageId: string;
      targetIndex: number;
    }>;

/** Alias reserved for future non-page product mutations. */
export type ProjectMutationCommand = PageMutationCommand;

export type PageMutationKind = PageMutationCommand['kind'];

export type PageAssetEffect =
  | 'none'
  | 'retained-reference'
  | 'cleanup-delegated'
  | 'unknown-engine-owned';

export type MutationEffects = Readonly<{
  /** Whether authored page content was created, copied, or removed. */
  contentChanged: boolean;
  /** Whether page structure/order changed, independent of authored content. */
  pageStructureChanged: boolean;
  /** Asset consequences known at the adapter boundary. */
  assetEffects: PageAssetEffect;
  /** Selection consequences remain engine-native; this is only an observation. */
  selection: 'unchanged' | 'active-page-changed' | 'engine-owned';
}>;

export type MutationErrorCode =
  | 'page-not-found'
  | 'cannot-remove-last-page'
  | 'unsupported'
  | 'invalid-reorder-target'
  | 'adapter-unavailable'
  | 'engine-error';

export type MutationError = Readonly<{
  code: MutationErrorCode;
  message: string;
}>;

type PageMutationResultContext = Readonly<{
  kind: PageMutationKind;
  projectId: string;
  affectedPageIds: readonly string[];
  activePageId: string | null;
  pageOrder: readonly string[];
}>;

export type PageMutationSuccess = PageMutationResultContext & Readonly<{
  ok: true;
  status: 'success';
  effects: MutationEffects;
  createdPageId?: string;
  removedPageId?: string;
}>;

export type PageMutationFailure = PageMutationResultContext & Readonly<{
  ok: false;
  status: 'rejected' | 'failed';
  error: MutationError;
}>;

export type PageMutationResult = PageMutationSuccess | PageMutationFailure;

/** Alias reserved for future project-level result unions. */
export type ProjectMutationResult = PageMutationResult;

export const createMutationSuccess = (
  context: PageMutationResultContext,
  effects: MutationEffects,
  extras: Readonly<{
    createdPageId?: string;
    removedPageId?: string;
  }> = {}
): PageMutationSuccess => ({
  ...context,
  ...extras,
  ok: true,
  status: 'success',
  effects,
});

export const createMutationFailure = (
  context: PageMutationResultContext,
  status: 'rejected' | 'failed',
  error: MutationError
): PageMutationFailure => ({
  ...context,
  ok: false,
  status,
  error,
});
