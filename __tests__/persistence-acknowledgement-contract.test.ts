import { describe, expect, it } from 'vitest';
import {
  acknowledgeConflict,
  acknowledgeDurableWrite,
  acknowledgeFailure,
  acknowledgeFileDelivery,
  acknowledgeInitiated,
  acknowledgeStaleCompletion,
  acknowledgementAllowsDirtyClear,
  acknowledgementBelongsTo,
  acknowledgementConfirmsDurability,
} from '../src/editor/session/persistenceAcknowledgement';
import { createInitialAuthoredRevision } from '../src/editor/session/authoredRevision';
import { createPersistenceOperationContext } from '../src/editor/session/persistenceOperation';

const context = createPersistenceOperationContext({
  operationId: 'operation-1',
  operationKind: 'project-save',
  revisionDomain: 'shared-authored',
  sessionIdentity: 'session-1',
  projectIdentity: 'project-1',
  targetIdentity: 'target-1',
  pageId: 'page-1',
  durableRevision: 4,
  authoredRevision: createInitialAuthoredRevision({
    sessionIdentity: 'session-1',
    projectIdentity: 'project-1',
  }),
  snapshot: { value: 'snapshot' },
});

describe('persistence acknowledgement contract', () => {
  it('distinguishes initiation from confirmed durable writes', () => {
    const initiated = acknowledgeInitiated(context);
    const committed = acknowledgeDurableWrite(context, 'target-1', 5);

    expect(initiated).toMatchObject({
      status: 'initiated',
      durability: 'unconfirmed',
      canClearDirty: false,
    });
    expect(committed).toMatchObject({
      status: 'durable-write-committed',
      targetIdentity: 'target-1',
      durableRevision: 5,
      durability: 'confirmed',
      canClearDirty: true,
    });
    expect(acknowledgementAllowsDirtyClear(committed)).toBe(true);
    expect(acknowledgementConfirmsDurability(committed)).toBe(true);
  });

  it('does not treat browser delivery, cancellation, stale work, conflict, or failure as durable', () => {
    const browser = acknowledgeFileDelivery(context, {
      status: 'initiated',
      fileName: 'project.json',
    });
    const cancelled = acknowledgeFileDelivery(context, {
      status: 'cancelled',
      fileName: 'project.json',
    });
    const stale = acknowledgeStaleCompletion(context, 'newer edit');
    const conflict = acknowledgeConflict(context, {
      expectedRevision: 4,
      actualRevision: 5,
    });
    const failed = acknowledgeFailure(context, 'disk full');

    expect(browser.status).toBe('browser-download-initiated');
    expect(cancelled.status).toBe('save-cancelled');
    expect(stale.status).toBe('stale-completion-rejected');
    expect(conflict).toMatchObject({
      status: 'conflict-detected',
      expectedRevision: 4,
      actualRevision: 5,
    });
    expect(failed).toMatchObject({ status: 'save-failed', error: 'disk full' });
    [browser, cancelled, stale, conflict, failed].forEach((acknowledgement) => {
      expect(acknowledgementAllowsDirtyClear(acknowledgement)).toBe(false);
      expect(acknowledgementConfirmsDurability(acknowledgement)).toBe(false);
    });
  });

  it('keeps acknowledgement ownership tied to the operation and authored revision', () => {
    const committed = acknowledgeDurableWrite(context, 'target-1', 5);
    expect(acknowledgementBelongsTo(committed, {
      operationId: 'operation-1',
      operationKind: 'project-save',
      revisionDomain: 'shared-authored',
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
      targetIdentity: 'target-1',
      pageId: 'page-1',
      authoredRevision: context.authoredRevision,
    })).toBe(true);
    expect(acknowledgementBelongsTo(committed, {
      operationId: 'other-operation',
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
      authoredRevision: context.authoredRevision,
    })).toBe(false);
    expect(acknowledgementBelongsTo(committed, {
      operationKind: 'autosave',
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
      targetIdentity: 'target-1',
      pageId: 'page-1',
      authoredRevision: context.authoredRevision,
    })).toBe(false);
    expect(acknowledgementBelongsTo(committed, {
      operationKind: 'project-save',
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
      targetIdentity: 'target-2',
      pageId: 'page-1',
      authoredRevision: context.authoredRevision,
    })).toBe(false);
    expect(acknowledgementBelongsTo(committed, {
      operationKind: 'project-save',
      revisionDomain: 'canvas-change',
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
      authoredRevision: context.authoredRevision,
    })).toBe(false);
  });
});
