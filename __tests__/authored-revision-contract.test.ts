import { describe, expect, it } from 'vitest';
import {
  advanceAuthoredRevision,
  authoredRevisionMatches,
  authoredRevisionOwnsProject,
  createInitialAuthoredRevision,
  createProjectReplacementRevision,
} from '../src/editor/session/authoredRevision';

describe('authored revision contract', () => {
  it('represents a live draft and promotes it without a second revision', () => {
    const initial = createInitialAuthoredRevision({
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
    });
    const draft = advanceAuthoredRevision(initial, {
      kind: 'draft-start',
      source: 'document',
      pageId: 'page-1',
    });
    const committed = advanceAuthoredRevision(draft, {
      kind: 'commit',
      source: 'document',
      pageId: 'page-1',
    });

    expect(draft).toMatchObject({
      sequence: 1,
      phase: 'draft',
      pageId: 'page-1',
      source: 'document',
    });
    expect(committed).toMatchObject({
      sequence: 1,
      phase: 'committed',
    });

    const updatedDraft = advanceAuthoredRevision(draft, {
      kind: 'draft-update',
      source: 'document',
      pageId: 'page-1',
    });
    expect(updatedDraft).toMatchObject({
      sequence: 1,
      phase: 'draft',
    });
  });

  it('advances authored state for mutations, Undo, and Redo while preserving identity', () => {
    const initial = createInitialAuthoredRevision({
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
    });
    const mutation = advanceAuthoredRevision(initial, {
      kind: 'mutation',
      source: 'canvas',
      pageId: 'page-1',
    });
    const undo = advanceAuthoredRevision(mutation, {
      kind: 'undo',
      source: 'canvas',
      pageId: 'page-1',
    });
    const redo = advanceAuthoredRevision(undo, {
      kind: 'redo',
      source: 'canvas',
      pageId: 'page-1',
    });

    expect([mutation.sequence, undo.sequence, redo.sequence]).toEqual([1, 2, 3]);
    expect(authoredRevisionOwnsProject(redo, {
      sessionIdentity: 'session-1',
      projectIdentity: 'project-1',
    })).toBe(true);
    expect(authoredRevisionMatches(redo, {
      ...redo,
      source: 'document',
    })).toBe(true);
    expect(authoredRevisionOwnsProject(redo, {
      sessionIdentity: 'other-session',
      projectIdentity: 'project-1',
    })).toBe(false);
  });

  it('starts a replacement project at a new session identity', () => {
    const replacement = createProjectReplacementRevision({
      sessionIdentity: 'session-2',
      projectIdentity: 'project-2',
    });
    expect(replacement).toMatchObject({
      sequence: 0,
      phase: 'committed',
      sessionIdentity: 'session-2',
      projectIdentity: 'project-2',
    });
  });
});
