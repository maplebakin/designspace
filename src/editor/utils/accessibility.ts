/**
 * accessibility - Accessibility utilities for the design space editor
 * Implements Task 11: Add accessibility features and ARIA roles
 */

/**
 * Focus management utilities
 */
export class FocusManager {
  private static instance: FocusManager;
  private focusHistory: HTMLElement[] = [];
  private trappedElements: HTMLElement[] = [];

  static getInstance(): FocusManager {
    if (!FocusManager.instance) {
      FocusManager.instance = new FocusManager();
    }
    return FocusManager.instance;
  }

  /**
   * Trap focus within a specific element
   */
  trapFocus(element: HTMLElement): void {
    this.trappedElements.push(element);
    element.setAttribute('aria-modal', 'true');
    element.setAttribute('role', 'dialog');

    // Store previously focused element
    const activeElement = document.activeElement as HTMLElement;
    if (activeElement) {
      this.focusHistory.push(activeElement);
    }

    // Focus the first focusable element in the modal
    const firstFocusable = this.getFirstFocusableElement(element);
    if (firstFocusable) {
      firstFocusable.focus();
    }

    // Listen for focus events to keep focus inside the modal
    document.addEventListener('focusin', this.handleFocusTrap);
  }

  /**
   * Release focus trap
   */
  releaseFocus(): void {
    if (this.trappedElements.length > 0) {
      const element = this.trappedElements.pop();
      if (element) {
        element.removeAttribute('aria-modal');
        element.removeAttribute('role');
      }
    }

    // Restore focus to the previously focused element
    if (this.focusHistory.length > 0) {
      const previousElement = this.focusHistory.pop();
      if (previousElement) {
        previousElement.focus();
      }
    }

    if (this.trappedElements.length === 0) {
      document.removeEventListener('focusin', this.handleFocusTrap);
    }
  }

  /**
   * Get the first focusable element within an element
   */
  private getFirstFocusableElement(element: HTMLElement): HTMLElement | null {
    const focusableSelectors = [
      '[tabindex]:not([tabindex="-1"])',
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'details',
      '[contenteditable="true"]',
    ].join(',');

    const focusableElements = Array.from(
      element.querySelectorAll<HTMLElement>(focusableSelectors)
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);

    return focusableElements[0] || null;
  }

  /**
   * Handle focus trap logic
   */
  private handleFocusTrap = (event: FocusEvent): void => {
    if (this.trappedElements.length === 0) return;

    const lastTrappedElement = this.trappedElements[this.trappedElements.length - 1];
    const activeElement = event.target as HTMLElement;

    // Check if the focused element is within the trapped element
    if (!lastTrappedElement.contains(activeElement)) {
      // Focus the first focusable element in the trapped element
      const firstFocusable = this.getFirstFocusableElement(lastTrappedElement);
      if (firstFocusable) {
        firstFocusable.focus();
      }
    }
  };

  /**
   * Focus the next focusable element
   */
  focusNext(currentElement: HTMLElement): void {
    const focusableElements = this.getAllFocusableElements();
    const currentIndex = focusableElements.indexOf(currentElement);

    if (currentIndex !== -1) {
      const nextIndex = (currentIndex + 1) % focusableElements.length;
      focusableElements[nextIndex].focus();
    }
  }

  /**
   * Focus the previous focusable element
   */
  focusPrevious(currentElement: HTMLElement): void {
    const focusableElements = this.getAllFocusableElements();
    const currentIndex = focusableElements.indexOf(currentElement);

    if (currentIndex !== -1) {
      const prevIndex = currentIndex === 0 ? focusableElements.length - 1 : currentIndex - 1;
      focusableElements[prevIndex].focus();
    }
  }

  /**
   * Get all focusable elements in the document
   */
  private getAllFocusableElements(): HTMLElement[] {
    const focusableSelectors = [
      '[tabindex]:not([tabindex="-1"])',
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'details',
      '[contenteditable="true"]',
    ].join(',');

    return Array.from(
      document.querySelectorAll<HTMLElement>(focusableSelectors)
    ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
  }
}

/**
 * Screen reader utilities
 */
export class ScreenReaderAnnouncer {
  private container: HTMLElement | null = null;

  constructor() {
    this.createContainer();
  }

  /**
   * Announce a message to screen readers
   */
  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    if (!this.container) {
      this.createContainer();
    }

    if (this.container) {
      // Clear previous content
      this.container.textContent = '';

      // Create a temporary element with the message
      const messageElement = document.createElement('div');
      messageElement.textContent = message;
      messageElement.setAttribute('aria-live', politeness);
      messageElement.setAttribute('aria-atomic', 'true');

      // Add to container
      this.container.appendChild(messageElement);

      // Remove after a delay to ensure it's announced
      setTimeout(() => {
        if (this.container && messageElement.parentNode === this.container) {
          this.container.removeChild(messageElement);
        }
      }, 1000);
    }
  }

  /**
   * Create the announcement container
   */
  private createContainer(): void {
    // Check if container already exists
    const existing = document.getElementById('screen-reader-announcer');
    if (existing) {
      this.container = existing;
      return;
    }

    this.container = document.createElement('div');
    this.container.id = 'screen-reader-announcer';
    this.container.setAttribute('aria-live', 'polite');
    this.container.setAttribute('aria-atomic', 'true');
    this.container.style.position = 'absolute';
    this.container.style.left = '-10000px';
    this.container.style.top = 'auto';
    this.container.style.width = '1px';
    this.container.style.height = '1px';
    this.container.style.overflow = 'hidden';

    document.body.appendChild(this.container);
  }
}

/**
 * Keyboard navigation utilities
 */
export class KeyboardNavigation {
  private static instance: KeyboardNavigation;
  private keyHandlers: Map<string, (event: KeyboardEvent) => void> = new Map();

  static getInstance(): KeyboardNavigation {
    if (!KeyboardNavigation.instance) {
      KeyboardNavigation.instance = new KeyboardNavigation();
    }
    return KeyboardNavigation.instance;
  }

  /**
   * Register a keyboard shortcut
   */
  registerShortcut(key: string, handler: (event: KeyboardEvent) => void): void {
    this.keyHandlers.set(key.toLowerCase(), handler);
    document.addEventListener('keydown', this.handleKeydown);
  }

  /**
   * Unregister a keyboard shortcut
   */
  unregisterShortcut(key: string): void {
    this.keyHandlers.delete(key.toLowerCase());
    if (this.keyHandlers.size === 0) {
      document.removeEventListener('keydown', this.handleKeydown);
    }
  }

  /**
   * Handle keydown events
   */
  private handleKeydown = (event: KeyboardEvent): void => {
    // Create a normalized key string
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.shiftKey) modifiers.push('shift');
    if (event.altKey) modifiers.push('alt');
    if (event.metaKey) modifiers.push('meta');

    const key = event.key.toLowerCase();
    const keyCombo = [...modifiers, key].join('+');

    // Check for exact match first
    if (this.keyHandlers.has(keyCombo)) {
      event.preventDefault();
      this.keyHandlers.get(keyCombo)!(event);
      return;
    }

    // Check for key only (without modifiers)
    if (this.keyHandlers.has(key)) {
      event.preventDefault();
      this.keyHandlers.get(key)!(event);
    }
  };
}

// Create singleton instances
export const focusManager = FocusManager.getInstance();
export const screenReaderAnnouncer = new ScreenReaderAnnouncer();
export const keyboardNavigation = KeyboardNavigation.getInstance();

// Initialize common shortcuts
keyboardNavigation.registerShortcut('ctrl+z', () => {
  // This would trigger the undo action in the editor
  screenReaderAnnouncer.announce('Undo action performed');
});

keyboardNavigation.registerShortcut('ctrl+y', () => {
  // This would trigger the redo action in the editor
  screenReaderAnnouncer.announce('Redo action performed');
});

keyboardNavigation.registerShortcut('ctrl+s', () => {
  // This would trigger the save action in the editor
  screenReaderAnnouncer.announce('Saving project');
});