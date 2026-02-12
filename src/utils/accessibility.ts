// Accessibility utilities for Design Space

export function generateAriaLabel(objectType: string, objectProperties?: Record<string, any>): string {
  const baseLabels: Record<string, string> = {
    'rect': 'Rectangle',
    'circle': 'Circle', 
    'triangle': 'Triangle',
    'i-text': 'Text',
    'group': 'Group of objects',
    'image': 'Image'
  };

  let label = baseLabels[objectType] || 'Object';

  if (objectProperties) {
    const details: string[] = [];
    
    if (objectProperties.text) {
      details.push(`Text: "${objectProperties.text}"`);
    }
    
    if (objectProperties.width && objectProperties.height) {
      details.push(`${Math.round(objectProperties.width)} by ${Math.round(objectProperties.height)} pixels`);
    }
    
    if (objectProperties.fill && objectProperties.fill !== 'transparent') {
      details.push(`Fill color: ${objectProperties.fill}`);
    }
    
    if (details.length > 0) {
      label += `, ${details.join(', ')}`;
    }
  }

  return label;
}

export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const announcementId = priority === 'assertive' ? 'sr-assertive' : 'sr-polite';
  
  // Create or find the live region
  let liveRegion = document.getElementById(announcementId);
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = announcementId;
    liveRegion.setAttribute('aria-live', priority);
    liveRegion.setAttribute('aria-atomic', 'true');
    liveRegion.className = 'sr-only';
    document.body.appendChild(liveRegion);
  }
  
  // Update the content
  liveRegion.textContent = message;
  
  // Clear after announcement
  setTimeout(() => {
    if (liveRegion) {
      liveRegion.textContent = '';
    }
  }, 1000);
}

export function setupKeyboardNavigation(canvas: any): void {
  // Enhanced keyboard navigation for canvas objects
  const handleKeyDown = (e: KeyboardEvent) => {
    const activeObject = canvas.getActiveObject();
    
    switch(e.key) {
      case 'Enter':
      case ' ':
        if (activeObject && activeObject.type === 'i-text') {
          // Enter text editing mode
          activeObject.enterEditing();
          announceToScreenReader(`Entered text editing mode for: ${activeObject.text}`);
        }
        break;
        
      case 'Escape':
        if (activeObject && activeObject.isEditing) {
          activeObject.exitEditing();
          announceToScreenReader('Exited text editing mode');
        } else {
          canvas.discardActiveObject();
          canvas.requestRenderAll();
          announceToScreenReader('Deselected object');
        }
        break;
    }
  };

  canvas.wrapperEl?.addEventListener('keydown', handleKeyDown);
}

export function createFocusManager() {
  let previousFocus: Element | null = null;
  
  return {
    captureFocus: () => {
      previousFocus = document.activeElement;
    },
    
    restoreFocus: () => {
      if (previousFocus && previousFocus instanceof HTMLElement) {
        previousFocus.focus();
      }
    },
    
    trapFocus: (container: HTMLElement) => {
      const focusableElements = container.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      if (focusableElements.length === 0) return;
      
      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
      
      const handleTabKey = (e: KeyboardEvent) => {
        if (e.key !== 'Tab') return;
        
        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      };
      
      container.addEventListener('keydown', handleTabKey);
      
      return () => {
        container.removeEventListener('keydown', handleTabKey);
      };
    }
  };
}

// CSS for screen reader only content
export const srOnlyStyles = `
  .sr-only {
    position: absolute !important;
    width: 1px !important;
    height: 1px !important;
    padding: 0 !important;
    margin: -1px !important;
    overflow: hidden !important;
    clip: rect(0, 0, 0, 0) !important;
    white-space: nowrap !important;
    border: 0 !important;
  }
  
  /* Focus indicators */
  .focus-visible {
    outline: 2px solid #2563eb !important;
    outline-offset: 2px !important;
  }
  
  /* High contrast mode support */
  @media (prefers-contrast: high) {
    .focus-visible {
      outline: 3px solid !important;
      outline-offset: 2px !important;
    }
  }
`;

export function injectAccessibilityStyles(): void {
  if (document.getElementById('accessibility-styles')) return;
  
  const style = document.createElement('style');
  style.id = 'accessibility-styles';
  style.textContent = srOnlyStyles;
  document.head.appendChild(style);
}