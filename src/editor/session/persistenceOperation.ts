/**
 * Minimal identity captured by an asynchronous persistence operation.
 *
 * The snapshot is intentionally opaque: each renderer owns its serialization
 * format, while this contract makes the operation's ownership explicit.
 */
export type PersistenceOperationContext<Snapshot> = Readonly<{
  sessionIdentity: string;
  projectIdentity: string;
  targetIdentity: string | null;
  pageId?: string;
  capturedRevision: number;
  snapshot: Snapshot;
}>;

export const persistenceOperationStillOwnsCurrentState = <Snapshot>(
  operation: PersistenceOperationContext<Snapshot>,
  current: Readonly<{
    sessionIdentity: string;
    projectIdentity: string;
    targetIdentity: string | null;
    revision: number;
  }>
) => (
  operation.sessionIdentity === current.sessionIdentity
  && operation.projectIdentity === current.projectIdentity
  && operation.targetIdentity === current.targetIdentity
  && operation.capturedRevision === current.revision
);
