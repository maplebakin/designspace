export interface MemoryStats {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  usage: number; // percentage
}

export function getMemoryStats(): MemoryStats | null {
  if (!(performance as any).memory) {
    return null;
  }

  const memory = (performance as any).memory;
  const used = memory.usedJSHeapSize;
  const total = memory.totalJSHeapSize;
  const limit = memory.jsHeapSizeLimit;

  return {
    usedJSHeapSize: used,
    totalJSHeapSize: total,
    jsHeapSizeLimit: limit,
    usage: (used / total) * 100
  };
}

export function checkMemoryPressure(threshold: number = 80): boolean {
  const stats = getMemoryStats();
  return stats ? stats.usage > threshold : false;
}

export class MemoryManager {
  private static instance: MemoryManager;
  private cleanupCallbacks: Array<() => void> = [];
  private monitoringInterval: number | null = null;
  private memoryThreshold: number = 80;

  private constructor() {}

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  addCleanupCallback(callback: () => void): void {
    this.cleanupCallbacks.push(callback);
  }

  removeCleanupCallback(callback: () => void): void {
    const index = this.cleanupCallbacks.indexOf(callback);
    if (index > -1) {
      this.cleanupCallbacks.splice(index, 1);
    }
  }

  startMonitoring(intervalMs: number = 5000, threshold: number = 80): void {
    this.memoryThreshold = threshold;
    console.log(`Memory monitoring started with threshold: ${threshold}%`);
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = window.setInterval(() => {
      const stats = getMemoryStats();
      if (stats && stats.usage > this.memoryThreshold) {
        console.warn(`Memory usage high: ${stats.usage.toFixed(1)}%`);
        this.performCleanup();
      }
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  performCleanup(): void {
    console.log('Performing memory cleanup...');
    
    // Run all registered cleanup callbacks
    this.cleanupCallbacks.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('Error during cleanup callback:', error);
      }
    });

    // Suggest garbage collection if available
    if ((window as any).gc) {
      try {
        (window as any).gc();
        console.log('Garbage collection triggered');
      } catch (error) {
        console.warn('Failed to trigger garbage collection:', error);
      }
    }
  }

  forceCleanup(): void {
    this.performCleanup();
  }

  getMemoryReport(): MemoryStats | null {
    const stats = getMemoryStats();
    if (stats) {
      return {
        ...stats,
        usage: parseFloat(stats.usage.toFixed(2))
      };
    }
    return null;
  }
}

