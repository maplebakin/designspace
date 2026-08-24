export type DocumentTypingLatencySample = Readonly<{
  sequence: number;
  key: string;
  keydownAt: number | null;
  beforeInputAt: number | null;
  inputAt: number | null;
  transactionStartAt: number | null;
  transactionEndAt: number | null;
  mutationAt: number | null;
  nextFrameAt: number | null;
}>;

type MutableSample = {
  sequence: number;
  key: string;
  keydownAt: number | null;
  beforeInputAt: number | null;
  inputAt: number | null;
  transactionStartAt: number | null;
  transactionEndAt: number | null;
  mutationAt: number | null;
  nextFrameAt: number | null;
};

type Metric = {
  count: number;
  totalMs: number;
  maxMs: number;
};

type CounterName =
  | 'lifecycleSubscriberInvocations'
  | 'lifecycleUiNotifications'
  | 'unifiedBridgeRenders'
  | 'unifiedSessionRenders'
  | 'documentShellRenders'
  | 'toolbarRenders'
  | 'reactCommits';

type DiagnosticsState = {
  active: boolean;
  startedAt: number | null;
  samples: MutableSample[];
  nextSequence: number;
  metrics: Record<string, Metric>;
  counters: Record<CounterName, number>;
  longTasksOver16Ms: number;
  longTasksOver50Ms: number;
  longTaskTotalMs: number;
  layoutReadCount: number;
  styleReadCount: number;
  mutationCount: number;
  unsupportedObservers: string[];
};

const createMetric = (): Metric => ({ count: 0, totalMs: 0, maxMs: 0 });

const createState = (): DiagnosticsState => ({
  active: false,
  startedAt: null,
  samples: [],
  nextSequence: 1,
  metrics: {},
  counters: {
    lifecycleSubscriberInvocations: 0,
    lifecycleUiNotifications: 0,
    unifiedBridgeRenders: 0,
    unifiedSessionRenders: 0,
    documentShellRenders: 0,
    toolbarRenders: 0,
    reactCommits: 0,
  },
  longTasksOver16Ms: 0,
  longTasksOver50Ms: 0,
  longTaskTotalMs: 0,
  layoutReadCount: 0,
  styleReadCount: 0,
  mutationCount: 0,
  unsupportedObservers: [],
});

let state = createState();
let cleanupCapture: (() => void) | null = null;
let activeRoot: HTMLElement | null = null;
let lastInputSample: MutableSample | null = null;
let lastKeydownSample: MutableSample | null = null;

const now = () => typeof performance === 'undefined' ? Date.now() : performance.now();

export const isDocumentTypingLatencyBenchmarkEnabled = () => {
  if (typeof window === 'undefined') return false;
  const query = new URLSearchParams(window.location.search);
  return query.get('typingBenchmark') === '1'
    || query.get('typingBenchmark') === 'desktop'
    || import.meta.env.VITE_DESIGN_SPACE_TYPING_BENCHMARK === 'desktop'
    || Boolean((globalThis as { __designSpaceTypingLatencyBenchmark?: boolean })
      .__designSpaceTypingLatencyBenchmark);
};

const metric = (name: string) => {
  state.metrics[name] ||= createMetric();
  return state.metrics[name];
};

export const measureDocumentTypingLatency = <T>(name: string, callback: () => T): T => {
  if (!state.active) return callback();
  const startedAt = now();
  try {
    return callback();
  } finally {
    const elapsed = now() - startedAt;
    const target = metric(name);
    target.count += 1;
    target.totalMs += elapsed;
    target.maxMs = Math.max(target.maxMs, elapsed);
  }
};

export const recordDocumentTypingLatencyCounter = (name: CounterName) => {
  if (!state.active) return;
  state.counters[name] += 1;
};

const findPendingSample = (predicate: (sample: MutableSample) => boolean) => {
  for (let index = state.samples.length - 1; index >= 0; index -= 1) {
    const sample = state.samples[index];
    if (predicate(sample)) return sample;
  }
  return null;
};

const createSample = (key: string, keydownAt: number | null): MutableSample => {
  const sample: MutableSample = {
    sequence: state.nextSequence++,
    key,
    keydownAt,
    beforeInputAt: null,
    inputAt: null,
    transactionStartAt: null,
    transactionEndAt: null,
    mutationAt: null,
    nextFrameAt: null,
  };
  state.samples.push(sample);
  if (state.samples.length > 2000) state.samples.shift();
  return sample;
};

const recordNextFrame = (sample: MutableSample) => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    sample.nextFrameAt = now();
    return;
  }
  window.requestAnimationFrame(() => {
    sample.nextFrameAt = now();
  });
};

export const recordDocumentTypingTransaction = (
  startedAt: number,
  endedAt: number
) => {
  if (!state.active) return;
  const sample = findPendingSample((candidate) => (
    candidate.transactionStartAt === null
    && candidate.inputAt === null
  )) || lastInputSample;
  if (!sample) return;
  sample.transactionStartAt = startedAt;
  sample.transactionEndAt = endedAt;
};

const patchLayoutReads = () => {
  if (typeof window === 'undefined' || typeof HTMLElement === 'undefined') {
    return () => undefined;
  }
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalComputedStyle = window.getComputedStyle;
  HTMLElement.prototype.getBoundingClientRect = function patchedRect(...args) {
    state.layoutReadCount += 1;
    return originalRect.apply(this, args);
  };
  window.getComputedStyle = function patchedComputedStyle(...args) {
    state.styleReadCount += 1;
    return originalComputedStyle.apply(window, args);
  };
  return () => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    window.getComputedStyle = originalComputedStyle;
  };
};

export const startDocumentTypingLatencyCapture = (root: HTMLElement) => {
  cleanupCapture?.();
  state = createState();
  state.active = true;
  state.startedAt = now();
  activeRoot = root;
  lastInputSample = null;
  lastKeydownSample = null;
  const desktopBenchmark = typeof window !== 'undefined'
    && (
      new URLSearchParams(window.location.search).get('typingBenchmark') === 'desktop'
      || import.meta.env.VITE_DESIGN_SPACE_TYPING_BENCHMARK === 'desktop'
    );
  const previousTitle = typeof document === 'undefined' ? '' : document.title;
  const desktopPanel = desktopBenchmark && typeof document !== 'undefined'
    ? document.createElement('textarea')
    : null;
  if (desktopPanel) {
    desktopPanel.id = 'document-typing-latency-panel';
    desktopPanel.readOnly = true;
    desktopPanel.setAttribute('aria-label', 'Document typing latency diagnostics');
    desktopPanel.style.position = 'fixed';
    desktopPanel.style.top = '8px';
    desktopPanel.style.right = '8px';
    desktopPanel.style.zIndex = '2147483647';
    desktopPanel.style.width = '430px';
    desktopPanel.style.height = '180px';
    desktopPanel.style.padding = '8px';
    desktopPanel.style.color = '#ffffff';
    desktopPanel.style.background = 'rgba(18, 24, 38, 0.94)';
    desktopPanel.style.border = '1px solid #90a4c2';
    desktopPanel.style.font = '12px/1.35 monospace';
    desktopPanel.style.userSelect = 'text';
    desktopPanel.style.pointerEvents = 'auto';
    document.body.appendChild(desktopPanel);
    desktopPanel.addEventListener('dblclick', () => {
      startDocumentTypingLatencyCapture(root);
    });
  }
  let setNativeWindowTitle: ((title: string) => Promise<void>) | null = null;
  if (
    desktopBenchmark
    && typeof window !== 'undefined'
    && '__TAURI_INTERNALS__' in window
  ) {
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        setNativeWindowTitle = (title) => getCurrentWindow().setTitle(title);
      })
      .catch(() => undefined);
  }
  const updateDesktopTitle = () => {
    if (!desktopBenchmark || typeof document === 'undefined') return;
    const summary = getDocumentTypingLatencyDiagnostics();
    const frame = summary.inputToNextFrameMs;
    const title = [
      'DS-TYPING',
      `n=${frame.count}`,
      `p50=${frame.p50 === null ? 'na' : frame.p50.toFixed(1)}`,
      `p95=${frame.p95 === null ? 'na' : frame.p95.toFixed(1)}`,
      `max=${frame.max === null ? 'na' : frame.max.toFixed(1)}`,
      `long50=${summary.longTasksOver50Ms}`,
      `bridge=${summary.counters.unifiedBridgeRenders}`,
      `life=${summary.counters.lifecycleSubscriberInvocations}`,
    ].join(' ');
    document.title = title;
    void setNativeWindowTitle?.(title);
    if (desktopPanel) {
      const header = document.querySelector<HTMLElement>(
        '[data-testid="unified-project-header"]'
      );
      const spanLayout = document.querySelector<HTMLElement>(
        '[data-document-span-layout]'
      );
      const liveSurface = document.querySelector<HTMLElement>(
        '.document-flow-prosemirror'
      );
      const liveContent = document.querySelector<HTMLElement>(
        '.document-flow-editor__content--structured-text-editing'
      );
      const textBand = document.querySelector<HTMLElement>(
        '[data-document-span-layout] [data-document-region-id]'
      );
      const pointOwner = document.elementFromPoint(470, 256);
      const pointPath = pointOwner
        ? (() => {
            const path: string[] = [];
            let node: HTMLElement | null = pointOwner as HTMLElement;
            while (node && path.length < 6) {
              path.push(
                `${node.tagName.toLowerCase()}.${String(node.className || '').replace(/\s+/g, '.')}`
                + (node.dataset.layoutRole ? `[role=${node.dataset.layoutRole}]` : '')
              );
              node = node.parentElement;
            }
            return path;
          })()
        : [];
      const compactSummary = [
        `frame n=${summary.inputToNextFrameMs.count} p50=${summary.inputToNextFrameMs.p50?.toFixed(1) ?? 'na'} p95=${summary.inputToNextFrameMs.p95?.toFixed(1) ?? 'na'} max=${summary.inputToNextFrameMs.max?.toFixed(1) ?? 'na'}`,
        `mutation n=${summary.inputToMutationMs.count} p50=${summary.inputToMutationMs.p50?.toFixed(1) ?? 'na'} p95=${summary.inputToMutationMs.p95?.toFixed(1) ?? 'na'} max=${summary.inputToMutationMs.max?.toFixed(1) ?? 'na'} long50=${summary.longTasksOver50Ms}`,
        `model builds=${Number(spanLayout?.getAttribute('data-layout-model-build-count') || 0)} ms=${Number(spanLayout?.getAttribute('data-total-layout-build-duration-ms') || 0).toFixed(1)} editing=${Boolean(liveContent)}`,
        `life notify=${summary.counters.lifecycleUiNotifications} subs=${summary.counters.lifecycleSubscriberInvocations} bridge=${summary.counters.unifiedBridgeRenders} shell=${summary.counters.documentShellRenders} auto=${Number(header?.getAttribute('data-autosave-invocations') || 0)}`,
        `revision=${Number(header?.getAttribute('data-authored-revision') || 0)} columns=${liveSurface ? getComputedStyle(liveSurface).columnCount : 'missing'} spanEditing=${spanLayout?.getAttribute('data-text-editing') || 'missing'}`,
        `work pm=${summary.metrics.proseMirrorTransaction?.totalMs.toFixed(1) ?? 'na'} shell=${summary.metrics.documentEditorShellUpdate?.totalMs.toFixed(1) ?? 'na'} format=${summary.metrics.toolbarFormatRead?.totalMs.toFixed(1) ?? 'na'} layout=${summary.layoutReadCount} style=${summary.styleReadCount}`,
        `hit=${pointPath[0] || pointOwner?.tagName || 'missing'} band=${textBand ? 'yes' : 'no'}`,
      ].join('\n');
      desktopPanel.value = compactSummary;
    }
  };
  const desktopTitleTimer = desktopBenchmark && typeof window !== 'undefined'
    ? window.setInterval(updateDesktopTitle, 250)
    : null;
  updateDesktopTitle();

  const isTypingKey = (event: KeyboardEvent) => (
    !event.isComposing
    && !event.ctrlKey
    && !event.metaKey
    && !event.altKey
    && (event.key.length === 1 || event.key === 'Enter' || event.key === 'Backspace')
  );
  const onKeydown = (event: KeyboardEvent) => {
    if (!isTypingKey(event)) return;
    lastKeydownSample = createSample(event.key, now());
  };
  const onBeforeInput = () => {
    const timestamp = now();
    const sample = lastKeydownSample
      && lastKeydownSample.beforeInputAt === null
      && lastKeydownSample.inputAt === null
      && lastKeydownSample.keydownAt !== null
      && timestamp - lastKeydownSample.keydownAt < 250
      ? lastKeydownSample
      : createSample('beforeinput', null);
    sample.beforeInputAt = timestamp;
  };
  const onInput = () => {
    const timestamp = now();
    const sample = lastKeydownSample
      && lastKeydownSample.inputAt === null
      && lastKeydownSample.beforeInputAt !== null
      ? lastKeydownSample
      : createSample('input', null);
    sample.inputAt = timestamp;
    lastInputSample = sample;
    recordNextFrame(sample);
  };
  const onReset = (event: KeyboardEvent) => {
    if (
      event.key.toLowerCase() !== 'r'
      || !event.ctrlKey
      || !event.altKey
      || !event.shiftKey
      || !activeRoot
    ) return;
    event.preventDefault();
    event.stopPropagation();
    startDocumentTypingLatencyCapture(activeRoot);
  };
  const mutationObserver = typeof MutationObserver === 'undefined'
    ? null
    : new MutationObserver(() => {
        state.mutationCount += 1;
        const sample = findPendingSample((candidate) => (
          candidate.inputAt !== null && candidate.mutationAt === null
        ));
        if (sample) {
          sample.mutationAt = now();
        }
      });
  mutationObserver?.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  root.addEventListener('keydown', onKeydown, true);
  root.addEventListener('beforeinput', onBeforeInput, true);
  root.addEventListener('input', onInput, true);
  window.addEventListener('keydown', onReset, true);

  let longTaskObserver: PerformanceObserver | null = null;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          const duration = entry.duration;
          state.longTaskTotalMs += duration;
          if (duration > 16) state.longTasksOver16Ms += 1;
          if (duration > 50) state.longTasksOver50Ms += 1;
        });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      state.unsupportedObservers.push('longtask');
    }
  } else {
    state.unsupportedObservers.push('longtask');
  }

  const restoreLayoutReads = patchLayoutReads();
  cleanupCapture = () => {
    state.active = false;
    root.removeEventListener('keydown', onKeydown, true);
    root.removeEventListener('beforeinput', onBeforeInput, true);
    root.removeEventListener('input', onInput, true);
    window.removeEventListener('keydown', onReset, true);
    mutationObserver?.disconnect();
    longTaskObserver?.disconnect();
    if (desktopTitleTimer !== null && typeof window !== 'undefined') {
      window.clearInterval(desktopTitleTimer);
    }
    if (desktopBenchmark && typeof document !== 'undefined') {
      document.title = previousTitle;
      void setNativeWindowTitle?.(previousTitle);
    }
    desktopPanel?.remove();
    restoreLayoutReads();
    if (activeRoot === root) activeRoot = null;
    cleanupCapture = null;
  };
  return cleanupCapture;
};

export const stopDocumentTypingLatencyCapture = () => {
  cleanupCapture?.();
};

export const resetDocumentTypingLatencyCapture = () => {
  if (activeRoot) startDocumentTypingLatencyCapture(activeRoot);
};

const percentile = (values: number[], point: number) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * point));
  return sorted[index];
};

export const getDocumentTypingLatencyDiagnostics = () => {
  const samples = state.samples.map((sample): DocumentTypingLatencySample => ({ ...sample }));
  const inputToFrame = samples
    .filter((sample) => sample.inputAt !== null && sample.nextFrameAt !== null)
    .map((sample) => (sample.nextFrameAt as number) - (sample.inputAt as number));
  const inputToMutation = samples
    .filter((sample) => sample.inputAt !== null && sample.mutationAt !== null)
    .map((sample) => (sample.mutationAt as number) - (sample.inputAt as number));
  return {
    active: state.active,
    startedAt: state.startedAt,
    samples,
    metrics: Object.fromEntries(
      Object.entries(state.metrics).map(([name, value]) => [name, { ...value }])
    ),
    counters: { ...state.counters },
    longTasksOver16Ms: state.longTasksOver16Ms,
    longTasksOver50Ms: state.longTasksOver50Ms,
    longTaskTotalMs: state.longTaskTotalMs,
    layoutReadCount: state.layoutReadCount,
    styleReadCount: state.styleReadCount,
    mutationCount: state.mutationCount,
    unsupportedObservers: [...state.unsupportedObservers],
    inputToNextFrameMs: {
      count: inputToFrame.length,
      p50: percentile(inputToFrame, 0.5),
      p95: percentile(inputToFrame, 0.95),
      max: inputToFrame.length > 0 ? Math.max(...inputToFrame) : null,
    },
    inputToMutationMs: {
      count: inputToMutation.length,
      p50: percentile(inputToMutation, 0.5),
      p95: percentile(inputToMutation, 0.95),
      max: inputToMutation.length > 0 ? Math.max(...inputToMutation) : null,
    },
  };
};

if (typeof globalThis !== 'undefined') {
  const target = globalThis as typeof globalThis & {
    __designSpaceTypingLatencyDiagnostics?: unknown;
  };
  target.__designSpaceTypingLatencyDiagnostics = {
    start: startDocumentTypingLatencyCapture,
    reset: resetDocumentTypingLatencyCapture,
    stop: stopDocumentTypingLatencyCapture,
    get: getDocumentTypingLatencyDiagnostics,
  };
}
