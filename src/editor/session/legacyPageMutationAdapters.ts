import { describeCanvasPageAssetReferences, describeDocumentPageAssetReferences } from './legacyAssetReferences';
import {
  createMutationFailure,
  createMutationSuccess,
  type MutationErrorCode,
  type MutationEffects,
  type PageMutationCommand,
  type PageMutationResult,
} from './projectMutation';
import { useDocumentStore } from '../../document/state/documentStore';
import { useEditorStore } from '../state/editorStore';
import type {
  PageAssetReferenceResult,
} from './assetReference';

type PageLike = Readonly<{ id: string }>;

const pageIds = (pages: readonly PageLike[]) => pages.map((page) => page.id);

const activePageId = (
  pages: readonly PageLike[],
  activePageIndex: number
) => pages[activePageIndex]?.id ?? null;

const errorMessage = (error: unknown, fallback: string) => (
  error instanceof Error && error.message ? error.message : fallback
);

const effects = ({
  contentChanged,
  pageStructureChanged,
  assetEffects,
  beforeActivePageId,
  afterActivePageId,
}: Readonly<{
  contentChanged: boolean;
  pageStructureChanged: boolean;
  assetEffects: MutationEffects['assetEffects'];
  beforeActivePageId: string | null;
  afterActivePageId: string | null;
}>): MutationEffects => ({
  contentChanged,
  pageStructureChanged,
  assetEffects,
  selection: beforeActivePageId === afterActivePageId
    ? 'unchanged'
    : 'active-page-changed',
});

const isValidIndex = (value: number, length: number) => (
  Number.isInteger(value) && value >= 0 && value < length
);

const mutationContext = (
  command: PageMutationCommand,
  pages: readonly PageLike[],
  activeIndex: number,
  affectedPageIds: readonly string[] = []
) => ({
  kind: command.kind,
  projectId: command.projectId,
  affectedPageIds,
  activePageId: activePageId(pages, activeIndex),
  pageOrder: pageIds(pages),
});

const reject = (
  command: PageMutationCommand,
  pages: readonly PageLike[],
  activeIndex: number,
  code: MutationErrorCode,
  message: string
) => createMutationFailure(
  mutationContext(command, pages, activeIndex),
  'rejected',
  { code, message }
);

const fail = (
  command: PageMutationCommand,
  pages: readonly PageLike[],
  activeIndex: number,
  message: string
) => createMutationFailure(
  mutationContext(command, pages, activeIndex),
  'failed',
  { code: 'engine-error', message }
);

const canvasProjectId = (state: ReturnType<typeof useEditorStore.getState>) => (
  state.productProjectFields?.projectId
  || state.currentLibraryProjectId
  || 'canvas-session'
);

const canvasSessionAvailable = (
  command: PageMutationCommand,
  state: ReturnType<typeof useEditorStore.getState>
) => command.projectId === canvasProjectId(state);

const documentProjectId = (state: ReturnType<typeof useDocumentStore.getState>) => (
  state.project?.projectId || null
);

const documentSessionAvailable = (
  command: PageMutationCommand,
  state: ReturnType<typeof useDocumentStore.getState>
) => command.projectId === documentProjectId(state);

const unsupported = (
  command: PageMutationCommand,
  pages: readonly PageLike[],
  activeIndex: number,
  label: string
) => reject(
  command,
  pages,
  activeIndex,
  'unsupported',
  `${label} is not supported by this project type.`
);

/** Delegates a normalized page command to the existing Canvas store. */
export const executeCanvasPageMutation = async (
  command: PageMutationCommand
): Promise<PageMutationResult> => {
  const before = useEditorStore.getState();
  const beforePages = before.pages;
  const beforeActivePageId = activePageId(beforePages, before.activePageIndex);
  if (!canvasSessionAvailable(command, before)) {
    return reject(
      command,
      beforePages,
      before.activePageIndex,
      'adapter-unavailable',
      'The Canvas project session is no longer active.'
    );
  }

  switch (command.kind) {
    case 'select-page': {
      const index = beforePages.findIndex((page) => page.id === command.pageId);
      if (index < 0) {
        return reject(
          command,
          beforePages,
          before.activePageIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      try {
        await before.switchToPage(index);
      } catch (error) {
        return fail(
          command,
          beforePages,
          before.activePageIndex,
          errorMessage(error, 'The Canvas page could not be selected.')
        );
      }
      const after = useEditorStore.getState();
      if (after.pages[after.activePageIndex]?.id !== command.pageId) {
        return fail(
          command,
          after.pages,
          after.activePageIndex,
          'The Canvas adapter did not select the requested page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, after.pages, after.activePageIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: false,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(after.pages, after.activePageIndex),
        })
      );
    }
    case 'add-page': {
      const beforeIds = new Set(pageIds(beforePages));
      try {
        await before.addPage();
      } catch (error) {
        return fail(
          command,
          beforePages,
          before.activePageIndex,
          errorMessage(error, 'The Canvas page could not be added.')
        );
      }
      const after = useEditorStore.getState();
      const createdPage = after.pages.find((page) => !beforeIds.has(page.id));
      if (!createdPage) {
        return fail(
          command,
          after.pages,
          after.activePageIndex,
          'The Canvas adapter did not report a newly added page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, after.pages, after.activePageIndex, [createdPage.id]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(after.pages, after.activePageIndex),
        }),
        { createdPageId: createdPage.id }
      );
    }
    case 'duplicate-page':
      return unsupported(command, beforePages, before.activePageIndex, 'Duplicate page');
    case 'remove-page': {
      const index = beforePages.findIndex((page) => page.id === command.pageId);
      if (index < 0) {
        return reject(
          command,
          beforePages,
          before.activePageIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      if (beforePages.length <= 1) {
        return reject(
          command,
          beforePages,
          before.activePageIndex,
          'cannot-remove-last-page',
          'A project must contain at least one page.'
        );
      }
      try {
        await before.deletePage(index);
      } catch (error) {
        return fail(
          command,
          beforePages,
          before.activePageIndex,
          errorMessage(error, 'The Canvas page could not be removed.')
        );
      }
      const after = useEditorStore.getState();
      if (after.pages.some((page) => page.id === command.pageId)) {
        return fail(
          command,
          after.pages,
          after.activePageIndex,
          'The Canvas adapter did not remove the requested page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, after.pages, after.activePageIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'cleanup-delegated',
          beforeActivePageId,
          afterActivePageId: activePageId(after.pages, after.activePageIndex),
        }),
        { removedPageId: command.pageId }
      );
    }
    case 'reorder-page': {
      const fromIndex = beforePages.findIndex((page) => page.id === command.pageId);
      if (fromIndex < 0) {
        return reject(
          command,
          beforePages,
          before.activePageIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      if (!isValidIndex(command.targetIndex, beforePages.length)) {
        return reject(
          command,
          beforePages,
          before.activePageIndex,
          'invalid-reorder-target',
          'The requested page position is invalid.'
        );
      }
      if (fromIndex === command.targetIndex) {
        return createMutationSuccess(
          mutationContext(command, beforePages, before.activePageIndex, [command.pageId]),
          effects({
            contentChanged: false,
            pageStructureChanged: false,
            assetEffects: 'none',
            beforeActivePageId,
            afterActivePageId: beforeActivePageId,
          })
        );
      }
      try {
        before.reorderPages(fromIndex, command.targetIndex);
      } catch (error) {
        return fail(
          command,
          beforePages,
          before.activePageIndex,
          errorMessage(error, 'The Canvas pages could not be reordered.')
        );
      }
      const after = useEditorStore.getState();
      if (after.pages[command.targetIndex]?.id !== command.pageId) {
        return fail(
          command,
          after.pages,
          after.activePageIndex,
          'The Canvas adapter did not apply the requested page order.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, after.pages, after.activePageIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(after.pages, after.activePageIndex),
        })
      );
    }
  }
};

export const describeCanvasPageAssets = (
  pageId: string
): PageAssetReferenceResult => {
  const state = useEditorStore.getState();
  const page = state.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    return {
      ok: false,
      pageId,
      reason: 'page-not-found',
      message: 'The requested page is no longer available.',
    };
  }
  try {
    return {
      ok: true,
      pageId,
      references: describeCanvasPageAssetReferences({
        page,
        imageAssets: state.imageAssets,
        stickers: state.assets,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      pageId,
      reason: 'engine-error',
      message: errorMessage(error, 'Canvas asset references could not be described.'),
    };
  }
};

/** Delegates a normalized page command to the existing Document store. */
export const executeDocumentPageMutation = async (
  command: PageMutationCommand
): Promise<PageMutationResult> => {
  const before = useDocumentStore.getState();
  const beforeProject = before.project;
  const beforePages = beforeProject?.pages || [];
  const beforeActiveIndex = beforeProject?.activePageIndex ?? 0;
  const beforeActivePageId = activePageId(beforePages, beforeActiveIndex);
  if (!beforeProject || !documentSessionAvailable(command, before)) {
    return reject(
      command,
      beforePages,
      beforeActiveIndex,
      'adapter-unavailable',
      'The Document project session is no longer active.'
    );
  }

  switch (command.kind) {
    case 'select-page': {
      const index = beforePages.findIndex((page) => page.id === command.pageId);
      if (index < 0) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      try {
        before.selectPage(index);
      } catch (error) {
        return fail(
          command,
          beforePages,
          beforeActiveIndex,
          errorMessage(error, 'The Document page could not be selected.')
        );
      }
      const afterProject = useDocumentStore.getState().project;
      const afterPages = afterProject?.pages || [];
      const afterIndex = afterProject?.activePageIndex ?? 0;
      if (afterPages[afterIndex]?.id !== command.pageId) {
        return fail(
          command,
          afterPages,
          afterIndex,
          'The Document adapter did not select the requested page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, afterPages, afterIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: false,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(afterPages, afterIndex),
        })
      );
    }
    case 'add-page': {
      const beforeIds = new Set(pageIds(beforePages));
      try {
        before.addPage();
      } catch (error) {
        return fail(
          command,
          beforePages,
          beforeActiveIndex,
          errorMessage(error, 'The Document page could not be added.')
        );
      }
      const afterProject = useDocumentStore.getState().project;
      const afterPages = afterProject?.pages || [];
      const afterIndex = afterProject?.activePageIndex ?? 0;
      const createdPage = afterPages.find((page) => !beforeIds.has(page.id));
      if (!createdPage) {
        return fail(
          command,
          afterPages,
          afterIndex,
          'The Document adapter did not report a newly added page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, afterPages, afterIndex, [createdPage.id]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(afterPages, afterIndex),
        }),
        { createdPageId: createdPage.id }
      );
    }
    case 'duplicate-page': {
      const sourceIndex = beforePages.findIndex((page) => page.id === command.sourcePageId);
      if (sourceIndex < 0) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'page-not-found',
          'The requested source page is no longer available.'
        );
      }
      try {
        before.duplicatePage(sourceIndex);
      } catch (error) {
        return fail(
          command,
          beforePages,
          beforeActiveIndex,
          errorMessage(error, 'The Document page could not be duplicated.')
        );
      }
      const afterProject = useDocumentStore.getState().project;
      const afterPages = afterProject?.pages || [];
      const afterIndex = afterProject?.activePageIndex ?? 0;
      const beforeIds = new Set(pageIds(beforePages));
      const createdPage = afterPages.find((page) => !beforeIds.has(page.id));
      if (!createdPage) {
        return fail(
          command,
          afterPages,
          afterIndex,
          'The Document adapter did not report a duplicated page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, afterPages, afterIndex, [command.sourcePageId, createdPage.id]),
        effects({
          contentChanged: true,
          pageStructureChanged: true,
          assetEffects: 'retained-reference',
          beforeActivePageId,
          afterActivePageId: activePageId(afterPages, afterIndex),
        }),
        { createdPageId: createdPage.id }
      );
    }
    case 'remove-page': {
      const index = beforePages.findIndex((page) => page.id === command.pageId);
      if (index < 0) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      if (beforePages.length <= 1) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'cannot-remove-last-page',
          'A document must contain at least one page.'
        );
      }
      try {
        before.removePage(index);
      } catch (error) {
        return fail(
          command,
          beforePages,
          beforeActiveIndex,
          errorMessage(error, 'The Document page could not be removed.')
        );
      }
      const afterProject = useDocumentStore.getState().project;
      const afterPages = afterProject?.pages || [];
      const afterIndex = afterProject?.activePageIndex ?? 0;
      if (afterPages.some((page) => page.id === command.pageId)) {
        return fail(
          command,
          afterPages,
          afterIndex,
          'The Document adapter did not remove the requested page.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, afterPages, afterIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'cleanup-delegated',
          beforeActivePageId,
          afterActivePageId: activePageId(afterPages, afterIndex),
        }),
        { removedPageId: command.pageId }
      );
    }
    case 'reorder-page': {
      const fromIndex = beforePages.findIndex((page) => page.id === command.pageId);
      if (fromIndex < 0) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'page-not-found',
          'The requested page is no longer available.'
        );
      }
      if (!isValidIndex(command.targetIndex, beforePages.length)) {
        return reject(
          command,
          beforePages,
          beforeActiveIndex,
          'invalid-reorder-target',
          'The requested page position is invalid.'
        );
      }
      if (fromIndex === command.targetIndex) {
        return createMutationSuccess(
          mutationContext(command, beforePages, beforeActiveIndex, [command.pageId]),
          effects({
            contentChanged: false,
            pageStructureChanged: false,
            assetEffects: 'none',
            beforeActivePageId,
            afterActivePageId: beforeActivePageId,
          })
        );
      }
      try {
        before.reorderPages(fromIndex, command.targetIndex);
      } catch (error) {
        return fail(
          command,
          beforePages,
          beforeActiveIndex,
          errorMessage(error, 'The Document pages could not be reordered.')
        );
      }
      const afterProject = useDocumentStore.getState().project;
      const afterPages = afterProject?.pages || [];
      const afterIndex = afterProject?.activePageIndex ?? 0;
      if (afterPages[command.targetIndex]?.id !== command.pageId) {
        return fail(
          command,
          afterPages,
          afterIndex,
          'The Document adapter did not apply the requested page order.'
        );
      }
      return createMutationSuccess(
        mutationContext(command, afterPages, afterIndex, [command.pageId]),
        effects({
          contentChanged: false,
          pageStructureChanged: true,
          assetEffects: 'none',
          beforeActivePageId,
          afterActivePageId: activePageId(afterPages, afterIndex),
        })
      );
    }
  }
};

export const describeDocumentPageAssets = (
  pageId: string
): PageAssetReferenceResult => {
  const state = useDocumentStore.getState();
  const page = state.project?.pages.find((candidate) => candidate.id === pageId);
  if (!page) {
    return {
      ok: false,
      pageId,
      reason: 'page-not-found',
      message: 'The requested page is no longer available.',
    };
  }
  try {
    return {
      ok: true,
      pageId,
      references: describeDocumentPageAssetReferences({
        page,
        assets: state.project?.assets,
        assetMetadata: state.project?.assetMetadata,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      pageId,
      reason: 'engine-error',
      message: errorMessage(error, 'Document asset references could not be described.'),
    };
  }
};
