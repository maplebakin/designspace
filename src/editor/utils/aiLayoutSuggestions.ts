/**
 * aiLayoutSuggestions - AI-assisted layout suggestions
 * Implements Task 12: Implement AI-assisted layout suggestions
 */

import * as fabric from 'fabric';

export interface LayoutSuggestion {
  id: string;
  name: string;
  description: string;
  objects: any[]; // Simplified object representations
  score: number; // Confidence score 0-1
}

export interface AlignmentSuggestion {
  id: string;
  type: 'balance' | 'alignment' | 'distribution' | 'proportion';
  objects: string[]; // IDs of affected objects
  action: () => void; // Function to apply the suggestion
  description: string;
}

export class AIAssistedLayout {
  private static instance: AIAssistedLayout;
  
  static getInstance(): AIAssistedLayout {
    if (!AIAssistedLayout.instance) {
      AIAssistedLayout.instance = new AIAssistedLayout();
    }
    return AIAssistedLayout.instance;
  }

  /**
   * Generate layout suggestions based on current canvas state
   */
  async generateLayoutSuggestions(canvas: fabric.Canvas): Promise<LayoutSuggestion[]> {
    const objects = canvas.getObjects();
    
    // If there are no objects, return empty suggestions
    if (objects.length === 0) {
      return [];
    }

    const suggestions: LayoutSuggestion[] = [];

    // Rule-based suggestions (would be replaced with actual AI in production)
    suggestions.push(...this.generateBalanceSuggestions(objects));
    suggestions.push(...this.generateAlignmentSuggestions(objects));
    suggestions.push(...this.generateDistributionSuggestions(objects));
    suggestions.push(...this.generateProportionSuggestions(objects));

    // Sort by score (confidence)
    return suggestions.sort((a, b) => b.score - a.score);
  }

  /**
   * Generate balance suggestions
   */
  private generateBalanceSuggestions(objects: fabric.Object[]): LayoutSuggestion[] {
    const suggestions: LayoutSuggestion[] = [];
    
    // Check if objects are balanced across the canvas
    const centerX = objects.reduce((sum: number, obj: fabric.Object) => sum + (obj.left || 0), 0) / objects.length;
    const canvasCenterX = 400; // Assuming canvas width of 800
    
    if (Math.abs(centerX - canvasCenterX) > 100) { // Threshold for imbalance
      suggestions.push({
        id: 'balance-center-' + Date.now(),
        name: 'Center Objects',
        description: 'Center all objects on the canvas',
        objects: objects.map(obj => this.objectToOptions(obj)),
        score: 0.8
      });
    }
    
    return suggestions;
  }

  /**
   * Generate alignment suggestions
   */
  private generateAlignmentSuggestions(objects: fabric.Object[]): LayoutSuggestion[] {
    const suggestions: LayoutSuggestion[] = [];
    
    // Check if objects are aligned
    const lefts = objects.map(obj => obj.left || 0);
    const tops = objects.map(obj => obj.top || 0);
    
    // Check if all objects have similar left positions (aligned vertically)
    const leftRange = Math.max(...lefts) - Math.min(...lefts);
    if (leftRange < 20) { // Within 20px tolerance
      suggestions.push({
        id: 'align-left-' + Date.now(),
        name: 'Align Vertically',
        description: 'Objects are nearly aligned vertically',
        objects: objects.map(obj => this.objectToOptions(obj)),
        score: 0.7
      });
    }
    
    // Check if all objects have similar top positions (aligned horizontally)
    const topRange = Math.max(...tops) - Math.min(...tops);
    if (topRange < 20) { // Within 20px tolerance
      suggestions.push({
        id: 'align-top-' + Date.now(),
        name: 'Align Horizontally',
        description: 'Objects are nearly aligned horizontally',
        objects: objects.map(obj => this.objectToOptions(obj)),
        score: 0.7
      });
    }
    
    return suggestions;
  }

  /**
   * Generate distribution suggestions
   */
  private generateDistributionSuggestions(objects: fabric.Object[]): LayoutSuggestion[] {
    const suggestions: LayoutSuggestion[] = [];
    
    if (objects.length >= 3) {
      // Check if objects are evenly distributed horizontally
      const sortedByLeft = [...objects].sort((a, b) => (a.left || 0) - (b.left || 0));
      const gaps = [];
      
      for (let i = 1; i < sortedByLeft.length; i++) {
        const gap = (sortedByLeft[i].left || 0) - (sortedByLeft[i-1].left || 0);
        gaps.push(gap);
      }
      
      if (gaps.length > 1) {
        const avgGap = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
        const gapVariance = gaps.reduce((sum, gap) => sum + Math.pow(gap - avgGap, 2), 0) / gaps.length;
        
        if (gapVariance > 100) { // High variance suggests uneven distribution
          suggestions.push({
            id: 'distribute-horizontally-' + Date.now(),
            name: 'Distribute Horizontally',
            description: 'Distribute objects evenly across horizontal space',
            objects: objects.map(obj => this.objectToOptions(obj)),
            score: 0.6
          });
        }
      }
    }
    
    return suggestions;
  }

  /**
   * Generate proportion suggestions
   */
  private generateProportionSuggestions(objects: fabric.Object[]): LayoutSuggestion[] {
    const suggestions: LayoutSuggestion[] = [];
    
    // Check if objects have similar sizes
    const widths = objects.map(obj => obj.width || 0);
    const heights = objects.map(obj => obj.height || 0);
    
    const widthStdDev = this.calculateStdDev(widths);
    const heightStdDev = this.calculateStdDev(heights);
    
    if (widthStdDev < 10 && widthStdDev > 0) { // Similar widths
      suggestions.push({
        id: 'uniform-width-' + Date.now(),
        name: 'Uniform Width',
        description: 'Objects have similar widths',
        objects: objects.map(obj => this.objectToOptions(obj)),
        score: 0.5
      });
    }
    
    if (heightStdDev < 10 && heightStdDev > 0) { // Similar heights
      suggestions.push({
        id: 'uniform-height-' + Date.now(),
        name: 'Uniform Height',
        description: 'Objects have similar heights',
        objects: objects.map(obj => this.objectToOptions(obj)),
        score: 0.5
      });
    }
    
    return suggestions;
  }

  /**
   * Calculate standard deviation
   */
  private calculateStdDev(values: number[]): number {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum: number, val: number) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum: number, val: number) => sum + val, 0) / values.length;
    
    return Math.sqrt(avgSquaredDiff);
  }

  /**
   * Convert fabric object to options for serialization
   */
  private objectToOptions(obj: fabric.Object): any {
    return {
      type: obj.type,
      left: obj.left,
      top: obj.top,
      width: obj.width,
      height: obj.height,
      scaleX: obj.scaleX,
      scaleY: obj.scaleY,
      angle: obj.angle,
      flipX: obj.flipX,
      flipY: obj.flipY,
      opacity: obj.opacity,
      fill: obj.fill,
      stroke: obj.stroke,
      strokeWidth: obj.strokeWidth,
      visible: obj.visible,
      selectable: obj.selectable,
      name: obj.name,
      id: (obj as any).id,
    };
  }

  /**
   * Apply a layout suggestion to the canvas
   */
  async applySuggestion(canvas: fabric.Canvas, suggestion: LayoutSuggestion): Promise<void> {
    // This is a simplified implementation
    // In a real AI system, this would apply the suggested layout changes
    
    switch (suggestion.name) {
      case 'Center Objects':
        this.centerObjects(canvas);
        break;
      case 'Distribute Horizontally':
        this.distributeHorizontally(canvas);
        break;
      case 'Align Vertically':
        this.alignObjectsVertically(canvas);
        break;
      case 'Align Horizontally':
        this.alignObjectsHorizontally(canvas);
        break;
      default:
        console.log('Applying generic suggestion:', suggestion.name);
        break;
    }
  }

  /**
   * Center all objects on the canvas
   */
  private centerObjects(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects();
    if (objects.length === 0) return;
    
    // Calculate center of all objects
    const totalLeft = objects.reduce((sum, obj) => sum + (obj.left || 0), 0);
    const totalTop = objects.reduce((sum, obj) => sum + (obj.top || 0), 0);
    const centerX = totalLeft / objects.length;
    const centerY = totalTop / objects.length;
    
    // Calculate canvas center
    const canvasCenterX = canvas.getWidth() / 2;
    const canvasCenterY = canvas.getHeight() / 2;
    
    // Move all objects to center the group
    const offsetX = canvasCenterX - centerX;
    const offsetY = canvasCenterY - centerY;
    
    objects.forEach(obj => {
      obj.set({
        left: (obj.left || 0) + offsetX,
        top: (obj.top || 0) + offsetY
      });
      obj.setCoords();
    });
    
    canvas.requestRenderAll();
  }

  /**
   * Distribute objects horizontally
   */
  private distributeHorizontally(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects();
    if (objects.length < 3) return;
    
    // Sort objects by their current left position
    const sortedObjects = [...objects].sort((a, b) => (a.left || 0) - (b.left || 0));
    
    // Calculate the total width of all objects
    const totalWidth = sortedObjects.reduce((sum, obj) => sum + (obj.width || 0) * (obj.scaleX || 1), 0);
    
    // Calculate the available space for distribution
    const canvasWidth = canvas.getWidth();
    const padding = (canvasWidth - totalWidth) / (sortedObjects.length + 1);
    
    // Position objects with equal spacing
    let currentLeft = padding;
    sortedObjects.forEach(obj => {
      const objWidth = (obj.width || 0) * (obj.scaleX || 1);
      obj.set({ left: currentLeft + objWidth / 2 });
      obj.setCoords();
      currentLeft += objWidth + padding;
    });
    
    canvas.requestRenderAll();
  }

  /**
   * Align objects vertically (same left position)
   */
  private alignObjectsVertically(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects();
    if (objects.length < 2) return;
    
    // Use the leftmost object's position as reference
    const leftmostObj = objects.reduce((leftmost: fabric.Object, obj: fabric.Object) =>
      (obj.left || 0) < (leftmost.left || 0) ? obj : leftmost
    );
    
    const referenceLeft = leftmostObj.left || 0;
    
    objects.forEach(obj => {
      obj.set({ left: referenceLeft });
      obj.setCoords();
    });
    
    canvas.requestRenderAll();
  }

  /**
   * Align objects horizontally (same top position)
   */
  private alignObjectsHorizontally(canvas: fabric.Canvas): void {
    const objects = canvas.getObjects();
    if (objects.length < 2) return;
    
    // Use the topmost object's position as reference
    const topmostObj = objects.reduce((topmost: fabric.Object, obj: fabric.Object) =>
      (obj.top || 0) < (topmost.top || 0) ? obj : topmost
    );
    
    const referenceTop = topmostObj.top || 0;
    
    objects.forEach(obj => {
      obj.set({ top: referenceTop });
      obj.setCoords();
    });
    
    canvas.requestRenderAll();
  }

  /**
   * Get color palette suggestions based on current objects
   */
  async getColorPaletteSuggestions(canvas: fabric.Canvas): Promise<string[]> {
    const objects = canvas.getObjects();
    const colors: string[] = [];
    
    objects.forEach(obj => {
      if (obj.fill && typeof obj.fill === 'string' && obj.fill.startsWith('#')) {
        colors.push(obj.fill);
      }
      if (obj.stroke && typeof obj.stroke === 'string' && obj.stroke.startsWith('#')) {
        colors.push(obj.stroke);
      }
    });
    
    // In a real implementation, this would use an AI model to suggest complementary colors
    // For now, return the existing colors
    return [...new Set(colors)]; // Remove duplicates
  }
}

// Create a singleton instance
export const aiLayout = AIAssistedLayout.getInstance();