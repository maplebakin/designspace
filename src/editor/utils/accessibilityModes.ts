/**
 * accessibilityModes - Accessibility modes and theming
 * Implements Task 17: Add accessibility modes and theming
 */


export type AccessibilityMode = 
  | 'standard'           // Normal mode
  | 'high-contrast'      // High contrast mode
  | 'dyslexia-friendly'  // Dyslexia-friendly mode
  | 'reduced-motion'     // Reduced motion mode
  | 'screen-reader'      // Optimized for screen readers
  | 'large-text';        // Large text mode

export interface AccessibilitySettings {
  mode: AccessibilityMode;
  fontSizeMultiplier: number;
  contrastLevel: number; // 0-100
  reduceMotion: boolean;
  dyslexiaFont: boolean;
  highVisibilityCursors: boolean;
  focusIndicatorThickness: number;
  skipAnimations: boolean;
  audioIndicators: boolean;
}

export class AccessibilityManager {
  private static instance: AccessibilityManager;
  private settings: AccessibilitySettings;
  private observers: Set<(settings: AccessibilitySettings) => void> = new Set();

  static getInstance(): AccessibilityManager {
    if (!AccessibilityManager.instance) {
      AccessibilityManager.instance = new AccessibilityManager();
    }
    return AccessibilityManager.instance;
  }

  constructor() {
    this.settings = this.getDefaultSettings();
    this.applySettingsToDOM();
  }

  /**
   * Get default accessibility settings
   */
  private getDefaultSettings(): AccessibilitySettings {
    return {
      mode: 'standard',
      fontSizeMultiplier: 1.0,
      contrastLevel: 50,
      reduceMotion: false,
      dyslexiaFont: false,
      highVisibilityCursors: false,
      focusIndicatorThickness: 2,
      skipAnimations: false,
      audioIndicators: false,
    };
  }

  /**
   * Apply settings to the DOM
   */
  private applySettingsToDOM(): void {
    const root = document.documentElement;
    
    // Apply CSS custom properties based on settings
    root.style.setProperty('--accessibility-font-size-multiplier', this.settings.fontSizeMultiplier.toString());
    root.style.setProperty('--accessibility-contrast-level', this.settings.contrastLevel.toString());
    root.style.setProperty('--accessibility-focus-thickness', `${this.settings.focusIndicatorThickness}px`);
    
    // Apply mode-specific classes
    root.classList.remove(
      'accessibility-mode-standard',
      'accessibility-mode-high-contrast', 
      'accessibility-mode-dyslexia-friendly',
      'accessibility-mode-reduced-motion',
      'accessibility-mode-screen-reader',
      'accessibility-mode-large-text'
    );
    root.classList.add(`accessibility-mode-${this.settings.mode}`);
    
    // Apply motion reduction
    if (this.settings.reduceMotion || this.settings.mode === 'reduced-motion') {
      root.classList.add('reduce-motion');
      root.style.setProperty('--animation-duration-factor', '0.1');
    } else {
      root.classList.remove('reduce-motion');
      root.style.setProperty('--animation-duration-factor', '1');
    }
    
    // Apply dyslexia-friendly font
    if (this.settings.dyslexiaFont || this.settings.mode === 'dyslexia-friendly') {
      root.style.setProperty('--font-family-accessible', '"OpenDyslexic", "Comic Sans MS", sans-serif');
    } else {
      root.style.setProperty('--font-family-accessible', 'inherit');
    }
  }

  /**
   * Update accessibility settings
   */
  updateSettings(newSettings: Partial<AccessibilitySettings>): void {
    this.settings = { ...this.settings, ...newSettings };
    this.applySettingsToDOM();
    
    // Notify observers
    this.observers.forEach(observer => observer(this.settings));
  }

  /**
   * Get current settings
   */
  getSettings(): AccessibilitySettings {
    return { ...this.settings };
  }

  /**
   * Set accessibility mode
   */
  setMode(mode: AccessibilityMode): void {
    this.updateSettings({ mode });
  }

  /**
   * Enable high contrast mode
   */
  enableHighContrast(): void {
    this.updateSettings({ 
      mode: 'high-contrast',
      contrastLevel: 80,
      dyslexiaFont: false,
    });
  }

  /**
   * Enable dyslexia-friendly mode
   */
  enableDyslexiaMode(): void {
    this.updateSettings({ 
      mode: 'dyslexia-friendly',
      dyslexiaFont: true,
      fontSizeMultiplier: 1.2,
      contrastLevel: 60,
    });
  }

  /**
   * Enable reduced motion mode
   */
  enableReducedMotion(): void {
    this.updateSettings({ 
      mode: 'reduced-motion',
      reduceMotion: true,
      skipAnimations: true,
    });
  }

  /**
   * Enable large text mode
   */
  enableLargeTextMode(multiplier: number = 1.5): void {
    this.updateSettings({ 
      mode: 'large-text',
      fontSizeMultiplier: multiplier,
    });
  }

  /**
   * Reset to standard mode
   */
  resetToStandard(): void {
    this.updateSettings(this.getDefaultSettings());
  }

  /**
   * Subscribe to settings changes
   */
  subscribe(observer: (settings: AccessibilitySettings) => void): () => void {
    this.observers.add(observer);
    
    // Return unsubscribe function
    return () => {
      this.observers.delete(observer);
    };
  }

  /**
   * Enhance focus indicators
   */
  enhanceFocusIndicators(): void {
    // Add a more visible focus indicator using CSS
    const styleId = 'accessibility-focus-enhancement';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;
    
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = styleId;
      document.head.appendChild(styleElement);
    }
    
    // Create enhanced focus styles
    styleElement.textContent = `
      [data-accessibility-enhanced="true"] :focus,
      [data-accessibility-enhanced="true"] :focus-visible {
        outline: var(--accessibility-focus-thickness, 3px) solid #ff00ff !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 var(--accessibility-focus-thickness, 3px) rgba(255, 0, 255, 0.3) !important;
      }
      
      /* High contrast mode specific styles */
      .accessibility-mode-high-contrast :focus,
      .accessibility-mode-high-contrast :focus-visible {
        outline: 4px solid #ffff00 !important;
        outline-offset: 2px !important;
        box-shadow: 0 0 0 4px rgba(255, 255, 0, 0.5) !important;
        background-color: rgba(0, 0, 0, 0.9) !important;
        color: #ffffff !important;
      }
      
      /* Dyslexia-friendly mode specific styles */
      .accessibility-mode-dyslexia-friendly {
        font-family: var(--font-family-accessible, "OpenDyslexic", "Comic Sans MS", sans-serif) !important;
        line-height: 1.6 !important;
      }
      
      .accessibility-mode-dyslexia-friendly * {
        font-family: inherit !important;
      }
      
      /* Reduced motion mode specific styles */
      .reduce-motion *,
      .accessibility-mode-reduced-motion * {
        animation-duration: var(--animation-duration-factor, 0.1) !important;
        transition-duration: var(--animation-duration-factor, 0.1) !important;
      }
    `;
  }

  /**
   * Apply accessibility attributes to UI elements
   */
  applyAccessibilityAttributes(): void {
    // Add accessibility attributes to the main canvas
    const canvasElement = document.getElementById('design-canvas');
    if (canvasElement) {
      canvasElement.setAttribute('role', 'region');
      canvasElement.setAttribute('aria-label', 'Design Canvas');
      canvasElement.setAttribute('aria-describedby', 'canvas-instructions');
    }

    // Enhance toolbar buttons with better labels
    const toolbarButtons = document.querySelectorAll('.toolbar button');
    toolbarButtons.forEach(button => {
      const label = button.getAttribute('title') || button.textContent || button.getAttribute('aria-label');
      if (label) {
        button.setAttribute('aria-label', label);
      }
      button.setAttribute('role', 'button');
    });

    // Add skip link for keyboard users
    this.addSkipLink();
  }

  /**
   * Add a skip link for keyboard navigation
   */
  private addSkipLink(): void {
    // Check if skip link already exists
    if (document.getElementById('skip-link')) return;

    const skipLink = document.createElement('a');
    skipLink.id = 'skip-link';
    skipLink.href = '#main-content';
    skipLink.textContent = 'Skip to main content';
    skipLink.className = 'skip-link visually-hidden focusable';
    skipLink.setAttribute('aria-label', 'Skip to main content');

    // Add CSS for skip link
    const style = document.createElement('style');
    style.textContent = `
      .skip-link {
        position: absolute;
        top: -40px;
        left: 6px;
        background: #000;
        color: #fff;
        padding: 8px;
        text-decoration: none;
        border-radius: 4px;
      }
      
      .skip-link:focus {
        top: 6px;
      }
      
      .visually-hidden {
        position: absolute !important;
        height: 1px;
        width: 1px;
        overflow: hidden;
        clip: rect(1px, 1px, 1px, 1px);
      }
      
      .focusable:focus {
        clip: auto;
        height: auto;
        width: auto;
      }
    `;
    
    document.head.appendChild(style);
    document.body.insertBefore(skipLink, document.body.firstChild);
  }

  /**
   * Detect system preferences for accessibility
   */
  detectSystemPreferences(): void {
    // Detect reduced motion preference
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.updateSettings({ reduceMotion: true });
    }

    // Detect high contrast preference (Windows high contrast mode)
    if (window.matchMedia('(prefers-contrast: high)').matches) {
      this.enableHighContrast();
    }

    // Detect forced colors (another way to detect high contrast mode)
    if (window.matchMedia('(forced-colors: active)').matches) {
      this.enableHighContrast();
    }

    // Detect reduced transparency preference
    if (window.matchMedia('(prefers-reduced-transparency: reduce)').matches) {
      // Reduce transparency in UI elements
      document.documentElement.style.setProperty('--transparency-reduced', 'true');
    }
  }

  /**
   * Initialize accessibility features
   */
  initialize(): void {
    this.detectSystemPreferences();
    this.applyAccessibilityAttributes();
    this.enhanceFocusIndicators();
    
    // Listen for changes in system preferences
    window.matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', (e) => {
        this.updateSettings({ reduceMotion: e.matches });
      });
      
    window.matchMedia('(prefers-contrast: high)')
      .addEventListener('change', (e) => {
        if (e.matches) {
          this.enableHighContrast();
        } else if (this.settings.mode === 'high-contrast') {
          this.resetToStandard();
        }
      });
  }
}

// Create a singleton instance
export const accessibilityManager = AccessibilityManager.getInstance();

// Initialize when the DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      accessibilityManager.initialize();
    });
  } else {
    // Document is already loaded
    accessibilityManager.initialize();
  }
}

// Export helper functions for UI components
export const isHighContrastMode = (): boolean => {
  return accessibilityManager.getSettings().mode === 'high-contrast';
};

export const isDyslexiaMode = (): boolean => {
  return accessibilityManager.getSettings().mode === 'dyslexia-friendly';
};

export const isReducedMotionMode = (): boolean => {
  return accessibilityManager.getSettings().mode === 'reduced-motion' || 
         accessibilityManager.getSettings().reduceMotion;
};

export const isLargeTextMode = (): boolean => {
  return accessibilityManager.getSettings().mode === 'large-text';
};