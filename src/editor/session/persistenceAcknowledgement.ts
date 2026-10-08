import type { FileDeliveryResult } from '../services/fileDeliveryService';
import type { AuthoredRevision } from './authoredRevision';
import type {
  PersistenceOperationKind,
  PersistenceRevisionDomain,
} from './persistenceOperation';

export type PersistenceAcknowledgementContext<Snapshot = unknown> = Readonly<{
  operationId: string;
  operationKind: PersistenceOperationKind;
  revisionDomain: PersistenceRevisionDomain;
  sessionIdentity: string;
  projectIdentity: string;
  targetIdentity: string | null;
  durableRevision?: number | null;
  pageId?: string;
  capturedRevision: number;
  authoredRevision: AuthoredRevision;
  snapshot: Snapshot;
}>;

type UnconfirmedAcknowledgement<Snapshot> = PersistenceAcknowledgementContext<Snapshot> & Readonly<{
  durability: 'unconfirmed';
  canClearDirty: false;
  superseded: boolean;
}>;

type ConfirmedAcknowledgement<Snapshot> = PersistenceAcknowledgementContext<Snapshot> & Readonly<{
  durability: 'confirmed';
  canClearDirty: true;
  superseded: false;
}>;

export type PersistenceAcknowledgement<Snapshot = unknown> =
  | (UnconfirmedAcknowledgement<Snapshot> & { status: 'initiated' })
  | (UnconfirmedAcknowledgement<Snapshot> & {
      status: 'target-allocated';
      targetIdentity: string;
    })
  | (ConfirmedAcknowledgement<Snapshot> & {
      status: 'durable-write-committed';
      targetIdentity: string;
      durableRevision: number;
    })
  | (UnconfirmedAcknowledgement<Snapshot> & {
      status: 'stale-completion-rejected';
      reason?: string;
    })
  | (UnconfirmedAcknowledgement<Snapshot> & {
      status: 'conflict-detected';
      expectedRevision?: number | null;
      actualRevision?: number | null;
    })
  | (UnconfirmedAcknowledgement<Snapshot> & {
      status: 'browser-download-initiated';
      fileName: string;
    })
  | (ConfirmedAcknowledgement<Snapshot> & {
      status: 'native-save-confirmed';
      targetIdentity: string;
      path?: string;
    })
  | (UnconfirmedAcknowledgement<Snapshot> & {
      status: 'save-failed';
      error: string;
    })
  | (UnconfirmedAcknowledgement<Snapshot> & { status: 'save-cancelled' });

export const acknowledgementAllowsDirtyClear = <Snapshot>(
  acknowledgement: PersistenceAcknowledgement<Snapshot>,
): acknowledgement is Extract<
  PersistenceAcknowledgement<Snapshot>,
  { canClearDirty: true }
> => acknowledgement.canClearDirty && !acknowledgement.superseded;

export const acknowledgementConfirmsDurability = <Snapshot>(
  acknowledgement: PersistenceAcknowledgement<Snapshot>,
) => acknowledgement.durability === 'confirmed' && !acknowledgement.superseded;

export const acknowledgementBelongsTo = <Snapshot>(
  acknowledgement: PersistenceAcknowledgement<Snapshot>,
  context: Readonly<{
    operationId?: string;
    operationKind?: PersistenceOperationKind;
    revisionDomain?: PersistenceRevisionDomain;
    sessionIdentity: string;
    projectIdentity: string;
    targetIdentity?: string | null;
    pageId?: string;
    capturedRevision?: number;
    authoredRevision: AuthoredRevision;
  }>,
) => (
  (!context.operationId || acknowledgement.operationId === context.operationId)
  && (!context.operationKind || acknowledgement.operationKind === context.operationKind)
  && (!context.revisionDomain || acknowledgement.revisionDomain === context.revisionDomain)
  && acknowledgement.sessionIdentity === context.sessionIdentity
  && acknowledgement.projectIdentity === context.projectIdentity
  && (
    context.targetIdentity === undefined
    || acknowledgement.targetIdentity === context.targetIdentity
    || (context.targetIdentity === null && acknowledgement.targetIdentity !== null)
  )
  && (context.pageId === undefined || acknowledgement.pageId === context.pageId)
  && (
    context.capturedRevision === undefined
    || acknowledgement.capturedRevision === context.capturedRevision
  )
  && acknowledgement.authoredRevision.sequence === context.authoredRevision.sequence
  && acknowledgement.authoredRevision.phase === context.authoredRevision.phase
  && acknowledgement.authoredRevision.pageId === context.authoredRevision.pageId
  && acknowledgement.authoredRevision.sessionIdentity === context.authoredRevision.sessionIdentity
  && acknowledgement.authoredRevision.projectIdentity === context.authoredRevision.projectIdentity
);

export const acknowledgeInitiated = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  status: 'initiated',
  durability: 'unconfirmed',
  canClearDirty: false,
  superseded: false,
});

export const acknowledgeTargetAllocated = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  targetIdentity: string,
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  targetIdentity,
  status: 'target-allocated',
  durability: 'unconfirmed',
  canClearDirty: false,
  superseded: false,
});

export const acknowledgeDurableWrite = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  targetIdentity: string,
  durableRevision: number,
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  targetIdentity,
  durableRevision,
  status: 'durable-write-committed',
  durability: 'confirmed',
  canClearDirty: true,
  superseded: false,
});

export const acknowledgeStaleCompletion = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  reason?: string,
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  status: 'stale-completion-rejected',
  ...(reason ? { reason } : {}),
  durability: 'unconfirmed',
  canClearDirty: false,
  superseded: true,
});

export const acknowledgeConflict = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  options: { expectedRevision?: number | null; actualRevision?: number | null } = {},
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  status: 'conflict-detected',
  ...options,
  durability: 'unconfirmed',
  canClearDirty: false,
  superseded: false,
});

export const acknowledgeFailure = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  error: string,
): PersistenceAcknowledgement<Snapshot> => ({
  ...context,
  status: 'save-failed',
  error,
  durability: 'unconfirmed',
  canClearDirty: false,
  superseded: false,
});

export const acknowledgeFileDelivery = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  delivery: FileDeliveryResult,
): PersistenceAcknowledgement<Snapshot> => {
  if (delivery.status === 'saved') {
    return {
      ...context,
      targetIdentity: delivery.path || context.targetIdentity || delivery.fileName,
      status: 'native-save-confirmed',
      path: delivery.path,
      durability: 'confirmed',
      canClearDirty: true,
      superseded: false,
    };
  }
  if (delivery.status === 'initiated') {
    return {
      ...context,
      status: 'browser-download-initiated',
      fileName: delivery.fileName,
      durability: 'unconfirmed',
      canClearDirty: false,
      superseded: false,
    };
  }
  return {
    ...context,
    status: 'save-cancelled',
    durability: 'unconfirmed',
    canClearDirty: false,
    superseded: false,
  };
};

/** Compatibility bridge for old boolean adapters during incremental migration. */
export const acknowledgeLegacyBoolean = <Snapshot>(
  context: PersistenceAcknowledgementContext<Snapshot>,
  succeeded: boolean,
  error = 'The durable write was not confirmed.',
): PersistenceAcknowledgement<Snapshot> => succeeded
  ? acknowledgeDurableWrite(
      context,
      context.targetIdentity || context.projectIdentity,
      context.authoredRevision.sequence,
    )
  : acknowledgeFailure(context, error);
