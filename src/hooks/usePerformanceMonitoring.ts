import { useEffect } from 'react';
import { PerformanceMonitor } from '../utils/performanceMonitor';
import type { PerformanceMetric } from '../utils/performanceMonitor';

export function usePerformanceMonitoring(monitorFPS: boolean = false) {
  const monitor = PerformanceMonitor.getInstance();

  useEffect(() => {
    if (monitorFPS) {
      monitor.startFPSMonitoring();
    }

    return () => {
      monitor.stopFPSMonitoring();
    };
  }, [monitorFPS, monitor]);

  return {
    startTimer: (name: string) => monitor.startTimer(name),
    recordMetric: (name: string, value: number, type: PerformanceMetric['type']) => 
      monitor.recordMetric(name, value, type),
    getReport: () => monitor.getReport(),
    logReport: () => monitor.logReport(),
    clearMetrics: () => monitor.clearMetrics()
  };
}