import { useState, useEffect } from 'react';
import { MemoryManager, getMemoryStats, type MemoryStats } from '../utils/memoryManager';

export function useMemoryManagement(threshold: number = 80) {
  const [memoryStats, setMemoryStats] = useState<MemoryStats | null>(null);
  const memoryManager = MemoryManager.getInstance();

  useEffect(() => {
    const updateStats = () => {
      const stats = getMemoryStats();
      setMemoryStats(stats);
      
      if (stats && stats.usage > threshold) {
        memoryManager.performCleanup();
      }
    };

    // Initial update
    updateStats();

    // Set up monitoring
    const interval = setInterval(updateStats, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [threshold, memoryManager]);

  return {
    memoryStats,
    performCleanup: () => memoryManager.performCleanup(),
    isHighMemoryUsage: memoryStats ? memoryStats.usage > threshold : false
  };
}