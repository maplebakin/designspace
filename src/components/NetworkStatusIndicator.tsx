import { useEffect, useState } from 'react';
import { WifiOff, Wifi } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { pwaOfflineManager } from '../editor/offline/pwaOfflineManager';
import { useEditorStore } from '../editor/state/editorStore';

export function NetworkStatusIndicator() {
  const { isOnline, isSlowConnection, effectiveType } = useNetworkStatus();
  const [hasOfflineState, setHasOfflineState] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const setCanvasObjects = useEditorStore((state) => state.setCanvasObjects);
  const setProjectName = useEditorStore((state) => state.setProjectName);

  useEffect(() => {
    void pwaOfflineManager.hasOfflineState().then(setHasOfflineState);
  }, [isOnline]);

  // Auto-expand when going offline
  useEffect(() => {
    if (!isOnline) {
      setIsExpanded(true);
    }
  }, [isOnline]);

  if (isOnline && !isSlowConnection) {
    return null;
  }

  const isOffline = !isOnline;

  return (
    <div
      className={`fixed bottom-20 left-4 z-50 rounded-2xl border backdrop-blur-[var(--ui-blur)] shadow-[var(--ui-shadow-strong)] transition-all duration-300 ${
        isOffline
          ? 'border-[color:var(--warm-rose)]/40 bg-[color:var(--warm-rose)]/12'
          : 'border-amber-400/40 bg-amber-100/80'
      }`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-4 py-2.5"
      >
        <div className={`relative flex items-center justify-center ${isOffline ? 'text-[color:var(--warm-rose)]' : 'text-amber-600'}`}>
          {isOffline ? (
            <WifiOff className="w-4 h-4" />
          ) : (
            <Wifi className="w-4 h-4" />
          )}
          <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full animate-pulse ${
            isOffline ? 'bg-[color:var(--warm-rose)]' : 'bg-amber-500'
          }`} />
        </div>

        <span className={`text-[11px] uppercase tracking-widest font-medium ${
          isOffline ? 'text-[color:var(--warm-ink)]' : 'text-amber-800'
        }`}>
          {isOffline ? 'Offline' : `Slow (${effectiveType})`}
        </span>
      </button>

      {isExpanded && (
        <div className={`px-4 pb-3 pt-0 border-t ${
          isOffline ? 'border-[color:var(--warm-rose)]/20' : 'border-amber-300/40'
        }`}>
          <p className={`text-[10px] uppercase tracking-widest mt-2 ${
            isOffline ? 'text-[color:var(--warm-ink)]/70' : 'text-amber-700/80'
          }`}>
            {isOffline
              ? 'Your work is saved locally. Changes will sync when you reconnect.'
              : 'Some features may load slowly.'}
          </p>

          {isOffline && hasOfflineState && (
            <button
              type="button"
              onClick={() => {
                void pwaOfflineManager.loadOfflineState().then((snapshot) => {
                  if (!snapshot) return;
                  setProjectName(snapshot.projectName);
                  setCanvasObjects(snapshot.canvasObjects);
                });
              }}
              className="mt-3 w-full rounded-xl border border-[color:var(--warm-rose)]/30 bg-[color:var(--warm-cream)] px-3 py-2 text-[10px] uppercase tracking-widest font-medium text-[color:var(--warm-ink)] hover:bg-[color:var(--warm-ivory)] transition-colors"
            >
              Restore Last Snapshot
            </button>
          )}
        </div>
      )}
    </div>
  );
}
