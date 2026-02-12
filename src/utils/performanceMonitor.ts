export interface PerformanceMetric {
  name: string;
  value: number;
  timestamp: number;
  type: 'timing' | 'memory' | 'fps' | 'render';
}

interface PerformanceReport {
  averages: Record<string, number>;
  p95: Record<string, number>;
  p99: Record<string, number>;
  totalMetrics: number;
  slowOperations: PerformanceMetric[];
}

export class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private observers: PerformanceObserver[] = [];
  private fpsFrame: number = 0;
  private lastFrameTime: number = performance.now();

  private constructor() {
    this.initializeObservers();
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  private initializeObservers(): void {
    if ('PerformanceObserver' in window) {
      // Observer for navigation timing
      const navObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'navigation') {
            const navEntry = entry as any;
            this.recordMetric('pageLoad', navEntry.loadEventEnd - navEntry.loadEventStart, 'timing');
          }
        }
      });
      navObserver.observe({ entryTypes: ['navigation'] });
      this.observers.push(navObserver);

      // Observer for paint timing
      const paintObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'paint') {
            this.recordMetric(entry.name, entry.startTime, 'timing');
          }
        }
      });
      paintObserver.observe({ entryTypes: ['paint'] });
      this.observers.push(paintObserver);
    }
  }

  startTimer(name: string): () => void {
    const startTime = performance.now();
    return () => {
      const duration = performance.now() - startTime;
      this.recordMetric(name, duration, 'timing');
    };
  }

  recordMetric(name: string, value: number, type: PerformanceMetric['type']): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricArray = this.metrics.get(name)!;
    metricArray.push({
      name,
      value,
      timestamp: Date.now(),
      type
    });

    // Keep only last 100 measurements per metric
    if (metricArray.length > 100) {
      metricArray.shift();
    }

    // Alert on performance issues
    this.checkPerformanceThresholds(name, value, type);
  }

  private checkPerformanceThresholds(name: string, value: number, type: PerformanceMetric['type']): void {
    const thresholds: Record<string, Record<PerformanceMetric['type'], number>> = {
      'canvasRender': { 'timing': 16.67, 'render': 16.67, 'fps': 55, 'memory': 100 },
      'objectCreation': { 'timing': 5, 'render': 5, 'fps': 200, 'memory': 50 },
      'exportOperation': { 'timing': 1000, 'render': 1000, 'fps': 0.1, 'memory': 500 },
      'historyOperation': { 'timing': 10, 'render': 10, 'fps': 100, 'memory': 25 }
    };

    const threshold = thresholds[name]?.[type];
    if (threshold && value > threshold) {
      console.warn(`Performance warning: ${name} took ${value.toFixed(2)}ms (threshold: ${threshold}ms)`);
      
      // Store slow operations for reporting
      this.recordMetric(`${name}_slow`, value, type);
    }
  }

  measureFPS(): void {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    const fps = 1000 / delta;
    
    this.recordMetric('fps', fps, 'fps');
    
    this.lastFrameTime = now;
    this.fpsFrame++;

    // Request next frame
    requestAnimationFrame(() => this.measureFPS());
  }

  startFPSMonitoring(): void {
    this.measureFPS();
  }

  stopFPSMonitoring(): void {
    // FPS monitoring will stop on next frame when no longer called
  }

  getReport(): PerformanceReport {
    const averages: Record<string, number> = {};
    const p95: Record<string, number> = {};
    const p99: Record<string, number> = {};
    const slowOperations: PerformanceMetric[] = [];

    let totalMetrics = 0;

    for (const [name, metrics] of this.metrics.entries()) {
      if (metrics.length === 0) continue;

      totalMetrics += metrics.length;

      // Calculate average
      const sum = metrics.reduce((acc, m) => acc + m.value, 0);
      averages[name] = sum / metrics.length;

      // Calculate percentiles
      const sortedValues = metrics.map(m => m.value).sort((a, b) => a - b);
      const p95Index = Math.floor(sortedValues.length * 0.95);
      const p99Index = Math.floor(sortedValues.length * 0.99);
      
      p95[name] = sortedValues[p95Index] || 0;
      p99[name] = sortedValues[p99Index] || 0;

      // Collect slow operations
      const slowThreshold = this.getSlowThreshold(name);
      const slow = metrics.filter(m => m.value > slowThreshold);
      slowOperations.push(...slow);
    }

    return {
      averages,
      p95,
      p99,
      totalMetrics,
      slowOperations
    };
  }

  private getSlowThreshold(name: string): number {
    const thresholds: Record<string, number> = {
      'fps': 30,
      'canvasRender': 16.67,
      'objectCreation': 10,
      'exportOperation': 500,
      'historyOperation': 50,
      'pageLoad': 3000
    };

    return thresholds[name] || 1000;
  }

  clearMetrics(): void {
    this.metrics.clear();
  }

  logReport(): void {
    const report = this.getReport();
    
    console.group('📊 Performance Report');
    console.log('📈 Averages:', report.averages);
    console.log('📊 95th Percentile:', report.p95);
    console.log('📊 99th Percentile:', report.p99);
    console.log(`📈 Total Metrics: ${report.totalMetrics}`);
    
    if (report.slowOperations.length > 0) {
      console.group('🐌 Slow Operations');
      report.slowOperations.forEach(op => {
        console.log(`${op.name}: ${op.value.toFixed(2)}ms at ${new Date(op.timestamp).toLocaleTimeString()}`);
      });
      console.groupEnd();
    }
    
    console.groupEnd();
  }
}

