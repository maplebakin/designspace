import { useState, useCallback } from 'react';
import { SerializedFabricObject } from '../state/editorStore';

interface HistoryState {
  objects: SerializedFabricObject[];
  viewport: {
    scale: number;
    offsetX: number;
    offsetY: number;
  };
}

const MAX_HISTORY_STEPS = 50;

export const useHistory = () => {
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const takeSnapshot = useCallback((objects: SerializedFabricObject[], viewport: HistoryState['viewport']) => {
    // Create a new snapshot
    const newSnapshot: HistoryState = {
      objects: JSON.parse(JSON.stringify(objects)), // Deep clone
      viewport: { ...viewport }
    };

    // If we're not at the end of the history, truncate everything after current index
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(newSnapshot);

    // Limit history to MAX_HISTORY_STEPS
    if (newHistory.length > MAX_HISTORY_STEPS) {
      newHistory.shift(); // Remove oldest entry
      setCurrentIndex(MAX_HISTORY_STEPS - 1);
    } else {
      setCurrentIndex(newHistory.length - 1);
    }

    setHistory(newHistory);
  }, [history, currentIndex]);

  const undo = useCallback(() => {
    if (!canUndo) return null;
    
    const newIndex = currentIndex - 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [canUndo, currentIndex, history]);

  const redo = useCallback(() => {
    if (!canRedo) return null;
    
    const newIndex = currentIndex + 1;
    setCurrentIndex(newIndex);
    return history[newIndex];
  }, [canRedo, currentIndex, history]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setCurrentIndex(-1);
  }, []);

  return {
    takeSnapshot,
    undo,
    redo,
    canUndo,
    canRedo,
    clearHistory,
    currentIndex,
    historyLength: history.length
  };
};