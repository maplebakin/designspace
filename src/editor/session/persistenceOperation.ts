import { v4 as uuidv4 } from 'uuid';
import type { AuthoredRevision } from './authoredRevision';

export type PersistenceOperationKind =
  | 'project-save'
  | 'autosave'
  | 'project-download'
  | 'template-save'
  | 'export-delivery';

/**
 * Identifies which revision clock owns `capturedRevision`.
 *
 * The clocks remain engine-specific where necessary, but every asynchronous
 * persistence operation must say which one it captured so a numeric revision
 * from one editor cannot be compared with a different editor's watermark.
 */
export type PersistenceRevisionDomain =
  | 'shared-authored'
  | 'canvas-change'
  | 'document-change';

/**
 * Minimal identity captured by an asynchronous persistence operation.
 *
 * The snapshot is intentionally opaque: each renderer owns its serialization
 * format, while this contract makes the operation's ownership explicit.
 */
export type PersistenceOperationContext<Snapshot> = Readonly<{
  operationId: string;
  operationKind: PersistenceOperationKind;
  revisionDomain: PersistenceRevisionDomain;
  sessionIdentity: string;
  projectIdentity: string;
  targetIdentity: string | null;
  /** Revision acknowledged by the durable target at capture time, if any. */
  durableRevision?: number | null;
  pageId?: string;
  capturedRevision: number;
  authoredRevision: AuthoredRevision;
  snapshot: Snapshot;
}>;

export const createPersistenceOperationContext = <Snapshot>(options: {
  operationKind: PersistenceOperationKind;
  revisionDomain: PersistenceRevisionDomain;
  sessionIdentity: string;
  projectIdentity: string;
  targetIdentity: string | null;
  durableRevision?: number | null;
  pageId?: string;
  capturedRevision?: number;
  authoredRevision: AuthoredRevision;
  snapshot: Snapshot;
  operationId?: string;
}): PersistenceOperationContext<Snapshot> => ({
  operationId: options.operationId ?? uuidv4(),
  operationKind: options.operationKind,
  revisionDomain: options.revisionDomain,
  sessionIdentity: options.sessionIdentity,
  projectIdentity: options.projectIdentity,
  targetIdentity: options.targetIdentity,
  ...(options.durableRevision !== undefined
    ? { durableRevision: options.durableRevision }
    : {}),
  ...(options.pageId ? { pageId: options.pageId } : {}),
  capturedRevision: options.capturedRevision ?? options.authoredRevision.sequence,
  authoredRevision: options.authoredRevision,
  snapshot: options.snapshot,
});

export const persistenceOperationStillOwnsCurrentState = <Snapshot>(
  operation: PersistenceOperationContext<Snapshot>,
  current: Readonly<{
    sessionIdentity: string;
    projectIdentity: string;
    targetIdentity: string | null;
    revisionDomain: PersistenceRevisionDomain;
    revision: number;
    authoredRevision: AuthoredRevision;
  }>
) => (
  operation.sessionIdentity === current.sessionIdentity
  && operation.revisionDomain === current.revisionDomain
  && (
    operation.projectIdentity === current.projectIdentity
    // A new canvas session receives its durable project ID only after the
    // first write. Keep that allocation attached to the originating session.
    || (
      operation.targetIdentity === null
      && operation.projectIdentity === 'canvas-session'
      && current.targetIdentity !== null
    )
  )
  && (
    operation.targetIdentity === current.targetIdentity
    // A first save has no target at capture time. Target adoption is valid
    // when the session/project/authored revision still prove ownership.
    || (operation.targetIdentity === null && current.targetIdentity !== null)
  )
  && operation.capturedRevision === current.revision
  && operation.authoredRevision.sessionIdentity === current.authoredRevision.sessionIdentity
  && operation.authoredRevision.projectIdentity === current.authoredRevision.projectIdentity
  && operation.authoredRevision.sequence === current.authoredRevision.sequence
  && operation.authoredRevision.phase === current.authoredRevision.phase
);
