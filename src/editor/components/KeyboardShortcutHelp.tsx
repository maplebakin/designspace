import React, { useEffect } from 'react';
import { useEditorStore } from '../state/editorStore';

interface ShortcutItem {
  keys: string[];
  action: string;
  category: string;
}

const shortcuts: ShortcutItem[] = [
  // Tools
  { keys: ['V'], action: 'Select Tool', category: 'Tools' },
  { keys: ['E'], action: 'Eraser Tool', category: 'Tools' },
  { keys: ['P'], action: 'Pencil Tool', category: 'Tools' },
  { keys: ['H'], action: 'Hand/Pan Tool', category: 'Tools' },

  // Shapes
  { keys: ['R'], action: 'Add Rectangle', category: 'Shapes' },
  { keys: ['C'], action: 'Add Circle', category: 'Shapes' },
  { keys: ['S'], action: 'Add Star', category: 'Shapes' },
  { keys: ['T'], action: 'Add Text', category: 'Shapes' },

  // Clipboard
  { keys: ['⌘', 'C'], action: 'Copy', category: 'Clipboard' },
  { keys: ['⌘', 'V'], action: 'Paste', category: 'Clipboard' },
  { keys: ['⌘', 'D'], action: 'Duplicate', category: 'Clipboard' },

  // History
  { keys: ['⌘', 'Z'], action: 'Undo', category: 'History' },
  { keys: ['⌘', 'Shift', 'Z'], action: 'Redo', category: 'History' },

  // Grouping
  { keys: ['⌘', 'G'], action: 'Group Objects', category: 'Grouping' },
  { keys: ['⌘', 'Shift', 'G'], action: 'Ungroup Objects', category: 'Grouping' },

  // Navigation & View
  { keys: ['⌘', 'K'], action: 'Quick Open Projects', category: 'Navigation' },
  { keys: ['3'], action: 'Zoom to Selection', category: 'Navigation' },
  { keys: ['G'], action: 'Toggle Grid', category: 'Navigation' },
  { keys: ['ESC'], action: 'Deselect All', category: 'Navigation' },

  // Edit
  { keys: ['Backspace'], action: 'Delete', category: 'Edit' },
  { keys: ['←', '↑', '→', '↓'], action: 'Nudge 1px', category: 'Movement' },
  { keys: ['Shift', '←', '↑', '→', '↓'], action: 'Nudge 10px', category: 'Movement' },

  // Export
  { keys: ['⌘', 'E'], action: 'Export / Download', category: 'Export' },

  // Help
  { keys: ['⌘', 'Shift', '/'], action: 'Show Keyboard Shortcuts', category: 'Help' },
];

const KeyDisplay: React.FC<{ keys: string[] }> = ({ keys }) => {
  return (
    <div className="flex items-center gap-1">
      {keys.map((key, idx) => (
        <React.Fragment key={idx}>
          <kbd className="px-2 py-1 text-xs rounded bg-white/10 border border-white/20 text-slate-200">
            {key}
          </kbd>
          {idx < keys.length - 1 && <span className="text-slate-500">+</span>}
        </React.Fragment>
      ))}
    </div>
  );
};

export const KeyboardShortcutHelp: React.FC = () => {
  const { showHelpModal, setShowHelpModal } = useEditorStore(state => ({
    showHelpModal: state.showHelpModal,
    setShowHelpModal: state.setShowHelpModal,
  }));

  // Manage focus when modal opens/closes
  useEffect(() => {
    if (showHelpModal) {
      // Focus the close button when modal opens
      const closeButton = document.querySelector('[aria-label="Close"]') as HTMLElement;
      if (closeButton) {
        closeButton.focus();
      }
    }
  }, [showHelpModal]);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showHelpModal) {
        setShowHelpModal(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showHelpModal, setShowHelpModal]);

  if (!showHelpModal) return null;

  // Group shortcuts by category
  const groupedShortcuts = shortcuts.reduce((acc, shortcut) => {
    if (!acc[shortcut.category]) {
      acc[shortcut.category] = [];
    }
    acc[shortcut.category].push(shortcut);
    return acc;
  }, {} as Record<string, ShortcutItem[]>);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => setShowHelpModal(false)}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="w-full max-w-2xl rounded-xl border border-white/10 bg-[color:var(--ui-panel)] p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
        aria-labelledby="keyboard-shortcuts-title"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 id="keyboard-shortcuts-title" className="text-xl font-semibold text-slate-200">Keyboard Shortcuts</h2>
          <button
            onClick={() => setShowHelpModal(false)}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-[color:var(--brand-primary)]"
            aria-label="Close"
            ref={(el) => {
              if (el && showHelpModal) {
                el.focus();
              }
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          {Object.entries(groupedShortcuts).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-sm font-medium text-slate-300 uppercase tracking-widest mb-3">{category}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {items.map((shortcut, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10"
                  >
                    <span className="text-slate-300">{shortcut.action}</span>
                    <KeyDisplay keys={shortcut.keys} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 pt-6 border-t border-white/10 text-center">
          <p className="text-sm text-slate-500">
            Press <kbd className="px-2 py-1 text-xs rounded bg-white/10 border border-white/20">ESC</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
};
