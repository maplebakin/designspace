export type DocumentLiveTextMetric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

export type DocumentLiveTextDiagnosticsSnapshot = {
  metrics: Record<string, DocumentLiveTextMetric>;
  projectSubscriberUpdates: number;
  shellRenders: number;
  projectReplacements: number;
  projectChangeNotifications: number;
  draftFlushes: number;
  fastTextCommits: number;
  fastTextCommitCharacters: number;
};

const createMetric = (): DocumentLiveTextMetric => ({
  count: 0,
  totalMs: 0,
  maxMs: 0,
});

let metrics: Record<string, DocumentLiveTextMetric> = {};
let projectSubscriberUpdates = 0;
let shellRenders = 0;
let projectReplacements = 0;
let projectChangeNotifications = 0;
let draftFlushes = 0;
let fastTextCommits = 0;
let fastTextCommitCharacters = 0;

const now = () => (
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()
);

export const measureDocumentLiveTextMetric = <T>(
  name: string,
  callback: () => T
): T => {
  const startedAt = now();
  try {
    return callback();
  } finally {
    const durationMs = Math.max(0, now() - startedAt);
    const current = metrics[name] || createMetric();
    metrics[name] = {
      count: current.count + 1,
      totalMs: current.totalMs + durationMs,
      maxMs: Math.max(current.maxMs, durationMs),
    };
  }
};

export const recordDocumentLiveTextMetric = (
  name: string,
  durationMs = 0
) => {
  const current = metrics[name] || createMetric();
  metrics[name] = {
    count: current.count + 1,
    totalMs: current.totalMs + Math.max(0, durationMs),
    maxMs: Math.max(current.maxMs, durationMs),
  };
};

export const recordDocumentProjectSubscriberUpdate = () => {
  projectSubscriberUpdates += 1;
};

export const recordDocumentShellRender = () => {
  shellRenders += 1;
};

export const recordDocumentProjectReplacement = () => {
  projectReplacements += 1;
};

export const recordDocumentProjectChangeNotification = () => {
  projectChangeNotifications += 1;
};

export const recordDocumentDraftFlush = (characterCount: number) => {
  draftFlushes += 1;
  fastTextCommitCharacters += Math.max(0, characterCount);
};

export const recordDocumentFastTextCommit = () => {
  fastTextCommits += 1;
};

export const resetDocumentLiveTextDiagnostics = () => {
  metrics = {};
  projectSubscriberUpdates = 0;
  shellRenders = 0;
  projectReplacements = 0;
  projectChangeNotifications = 0;
  draftFlushes = 0;
  fastTextCommits = 0;
  fastTextCommitCharacters = 0;
};

export const getDocumentLiveTextDiagnostics = (): DocumentLiveTextDiagnosticsSnapshot => ({
  metrics: Object.fromEntries(
    Object.entries(metrics).map(([name, metric]) => [name, { ...metric }])
  ),
  projectSubscriberUpdates,
  shellRenders,
  projectReplacements,
  projectChangeNotifications,
  draftFlushes,
  fastTextCommits,
  fastTextCommitCharacters,
});

