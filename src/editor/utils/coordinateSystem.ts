/**
 * CoordinateSystem - Centralized unit scale management
 * Implements Task 4.1: Centralized Unit Scale Management from the roadmap
 */

import { UnitMode, unitScale as unitScaleMap } from './units';
import { useEditorStore } from '../state/editorStore';

export class CoordinateSystem {
  private mode: UnitMode = 'px';
  private scale: number = 1;
  private zoom: number = 1;
  private lockCounter: number = 0;

  constructor(initialMode: UnitMode = 'px') {
    this.mode = initialMode;
    this.scale = unitScaleMap[initialMode];
  }

  /**
   * Lock the coordinate system to prevent changes during sensitive operations
   */
  lock(): void {
    this.lockCounter += 1;
  }

  /**
   * Unlock the coordinate system
   */
  unlock(): void {
    this.lockCounter = Math.max(0, this.lockCounter - 1);
  }

  /**
   * Set the unit mode (px, in, cm, mm)
   * Throws an error if the system is locked
   */
  setMode(newMode: UnitMode): void {
    if (this.lockCounter > 0) {
      throw new Error('Cannot change unit mode while locked');
    }
    
    if (!(newMode in unitScaleMap)) {
      throw new Error(`Invalid unit mode: ${newMode}`);
    }
    
    this.mode = newMode;
    this.scale = unitScaleMap[newMode];
    this.recalculate();
  }

  /**
   * Set the zoom level
   */
  setZoom(newZoom: number): void {
    this.zoom = newZoom;
    this.recalculate();
  }

  /**
   * Recalculate dependent values and update the store
   */
  private recalculate(): void {
    // Update unitZoom atomically
    const unitZoom = this.zoom * this.scale;
    
    useEditorStore.setState({
      unitScale: this.scale,
      unitZoom,
      zoom: this.zoom,
      unitMode: this.mode,
    });
  }

  /**
   * Convert a value from canvas units to the current unit system
   */
  toCanvas(value: number): number {
    return value * this.scale;
  }

  /**
   * Convert a value from the current unit system to canvas units
   */
  fromCanvas(value: number): number {
    return value / this.scale;
  }

  /**
   * Get the current unit mode
   */
  getMode(): UnitMode {
    return this.mode;
  }

  /**
   * Get the current scale factor
   */
  getScale(): number {
    return this.scale;
  }

  /**
   * Get the current zoom level
   */
  getZoom(): number {
    return this.zoom;
  }

  /**
   * Get the current unit zoom (zoom * scale)
   */
  getUnitZoom(): number {
    return this.zoom * this.scale;
  }

  /**
   * Check if the coordinate system is currently locked
   */
  isLocked(): boolean {
    return this.lockCounter > 0;
  }

  /**
   * Get the lock counter value
   */
  getLockCount(): number {
    return this.lockCounter;
  }
}

// Create a singleton instance for the whole application
export const coordinateSystem = new CoordinateSystem();