/**
 * telemetry - Performance and usage metrics tracking
 * Implements Task 10: Implement telemetry and instrumentation for performance metrics
 */

export interface TelemetryEvent {
  name: string;
  timestamp: number;
  duration?: number;
  properties?: Record<string, any>;
  measurements?: Record<string, number>;
}

export interface PerformanceMetrics {
  frameRate: number;
  memoryUsage: number;
  canvasRenderTime: number;
  commitDuration: number;
}

class TelemetryService {
  private events: TelemetryEvent[] = [];
  private lastFrameTime: number = performance.now();
  private frameRate: number = 0;
  private enabled: boolean = true;

  constructor() {
    this.setupFrameRateTracking();
  }

  /**
   * Enable or disable telemetry collection
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Track a custom event
   */
  trackEvent(event: Omit<TelemetryEvent, 'timestamp'>): void {
    if (!this.enabled) return;

    const telemetryEvent: TelemetryEvent = {
      ...event,
      timestamp: performance.now(),
    };

    this.events.push(telemetryEvent);
    
    // Log to console in development
    if (typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env.NODE_ENV === 'development') {
      console.log(`[TELEMETRY] ${event.name}`, {
        duration: event.duration,
        properties: event.properties,
        measurements: event.measurements,
      });
    }
  }

  /**
   * Track a performance measurement
   */
  trackPerformance(name: string, startMark: string, endMark: string): void {
    if (!this.enabled) return;

    try {
      performance.measure(name, startMark, endMark);
      const measure = performance.getEntriesByName(name)[0] as PerformanceMeasure;
      if (measure) {
        this.trackEvent({
          name: `performance.${name}`,
          duration: measure.duration,
          measurements: {
            duration: measure.duration,
          },
        });
      }
    } catch (error) {
      console.warn(`Failed to track performance for ${name}:`, error);
    }
  }

  /**
   * Start measuring performance with a mark
   */
  startMark(markName: string): void {
    if (!this.enabled) return;
    performance.mark(markName);
  }

  /**
   * End measuring performance with a mark and track the measurement
   */
  endMark(startMark: string, endMark: string, eventName: string): void {
    if (!this.enabled) return;
    performance.mark(endMark);
    this.trackPerformance(eventName, startMark, endMark);
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return {
      frameRate: this.frameRate,
      memoryUsage: this.getMemoryUsage(),
      canvasRenderTime: this.getCanvasRenderTime(),
      commitDuration: this.getCommitDuration(),
    };
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50): TelemetryEvent[] {
    return this.events.slice(-limit);
  }

  /**
   * Clear all collected events
   */
  clearEvents(): void {
    this.events = [];
  }

  /**
   * Setup frame rate tracking
   */
  private setupFrameRateTracking(): void {
    const updateFrameRate = () => {
      const now = performance.now();
      const delta = now - this.lastFrameTime;
      this.lastFrameTime = now;
      
      if (delta > 0) {
        // Calculate FPS (frames per second)
        const fps = 1000 / delta;
        // Smooth the frame rate with a moving average
        this.frameRate = this.frameRate ? (this.frameRate * 0.7 + fps * 0.3) : fps;
      }
      
      requestAnimationFrame(updateFrameRate);
    };
    
    requestAnimationFrame(updateFrameRate);
  }

  /**
   * Get memory usage if available
   */
  private getMemoryUsage(): number {
    if ('memory' in performance) {
      return (performance as any).memory.usedJSHeapSize;
    }
    return 0;
  }

  /**
   * Get estimated canvas render time
   */
  private getCanvasRenderTime(): number {
    // Look for recent canvas render events
    const recentCanvasEvents = this.events
      .filter(e => e.name.includes('canvas.render'))
      .slice(-5);
    
    if (recentCanvasEvents.length === 0) return 0;
    
    const avgDuration = recentCanvasEvents.reduce((sum, e) => sum + (e.duration || 0), 0) / recentCanvasEvents.length;
    return avgDuration;
  }

  /**
   * Get commit duration
   */
  private getCommitDuration(): number {
    // Look for recent commit events
    const recentCommitEvents = this.events
      .filter(e => e.name.includes('commit'))
      .slice(-5);
    
    if (recentCommitEvents.length === 0) return 0;
    
    const avgDuration = recentCommitEvents.reduce((sum, e) => sum + (e.duration || 0), 0) / recentCommitEvents.length;
    return avgDuration;
  }

  /**
   * Report telemetry to an endpoint (placeholder implementation)
   */
  async reportTelemetry(_endpoint: string): Promise<void> {
    if (!this.enabled) return;

    const payload = {
      events: this.getRecentEvents(100),
      metrics: this.getPerformanceMetrics(),
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
    };

    try {
      // In a real implementation, you would send this to your telemetry service
      // await fetch(endpoint, {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(payload),
      // });

      // For now, just log it
      console.log('[TELEMETRY REPORT]', payload);
    } catch (error) {
      console.error('Failed to report telemetry:', error);
    }
  }
}

// Create a singleton instance
export const telemetry = new TelemetryService();

// Convenience functions
export const trackCanvasInitStarted = () => telemetry.startMark('canvas.init.start');
export const trackCanvasInitCompleted = () => telemetry.endMark('canvas.init.start', 'canvas.init.end', 'canvas.init.duration');
export const trackCanvasSyncTriggered = (reason: string) => telemetry.trackEvent({ name: 'canvas.sync.triggered', properties: { reason } });
export const trackCanvasForceRerender = (attempt: number, reason: string) => telemetry.trackEvent({ name: 'canvas.forceRerender.triggered', properties: { attempt, reason } });
export const trackRAFScheduled = (taskCount: number) => telemetry.trackEvent({ name: 'canvas.raf.scheduled', measurements: { taskCount } });
export const trackRAFExecuted = (duration: number, tasksExecuted: number) => telemetry.trackEvent({ name: 'canvas.raf.executed', duration, measurements: { tasksExecuted } });