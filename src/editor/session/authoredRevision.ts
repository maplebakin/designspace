import type { ProjectChangeSource } from './projectChangeCoordinator';

export type AuthoredRevisionPhase = 'draft' | 'committed';
export type AuthoredRevisionSource = ProjectChangeSource;

/**
 * Events at the authored-state boundary. A draft is visible in an engine but
 * is not yet a committed project transition; its commit promotes the same
 * sequence instead of creating a second authored version.
 * `draft-update` is a repeated live-input notification and intentionally does
 * not change the revision until a commit arrives.
 */
export type AuthoredRevisionEvent = Readonly<{
  kind: 'draft-start' | 'draft-update' | 'commit' | 'mutation' | 'undo' | 'redo';
  source: AuthoredRevisionSource;
  pageId?: string | null;
}>;

export type AuthoredRevision = Readonly<{
  sessionIdentity: string;
  projectIdentity: string;
  pageId: string | null;
  sequence: number;
  phase: AuthoredRevisionPhase;
  source: AuthoredRevisionSource | null;
}>;

export const createInitialAuthoredRevision = (options: {
  sessionIdentity: string;
  projectIdentity: string;
}): AuthoredRevision => ({
  sessionIdentity: options.sessionIdentity,
  projectIdentity: options.projectIdentity,
  pageId: null,
  sequence: 0,
  phase: 'committed',
  source: null,
});

export const createProjectReplacementRevision = (options: {
  sessionIdentity: string;
  projectIdentity: string;
}): AuthoredRevision => createInitialAuthoredRevision(options);

export const advanceAuthoredRevision = (
  current: AuthoredRevision,
  event: AuthoredRevisionEvent,
): AuthoredRevision => {
  if (event.kind === 'draft-update') return current;
  const pageId = event.pageId === undefined ? current.pageId : event.pageId;
  const isSameDraft = event.kind === 'draft-start' && current.phase === 'draft';
  const isDraftCommit = event.kind === 'commit' && current.phase === 'draft';
  return {
    ...current,
    pageId,
    sequence: isSameDraft || isDraftCommit
      ? current.sequence
      : current.sequence + 1,
    phase: event.kind === 'draft-start' ? 'draft' : 'committed',
    source: event.source,
  };
};

export const authoredRevisionMatches = (
  first: AuthoredRevision | null | undefined,
  second: AuthoredRevision | null | undefined,
) => Boolean(
  first
  && second
  && first.sessionIdentity === second.sessionIdentity
  && first.projectIdentity === second.projectIdentity
  && first.sequence === second.sequence
  && first.phase === second.phase
);

export const authoredRevisionOwnsProject = (
  revision: AuthoredRevision,
  context: Readonly<{
    sessionIdentity: string;
    projectIdentity: string;
  }>,
) => (
  revision.sessionIdentity === context.sessionIdentity
  && revision.projectIdentity === context.projectIdentity
);
