import React, { useEffect, useRef, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import {
  Copy,
  Clipboard,
  CopyPlus,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowUp,
  ArrowDown,
  Lock,
  Unlock,
} from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import {
  copySelection,
  pasteFromClipboard,
  duplicateSelection,
  bringToFront,
  sendToBack,
  bringForward,
  sendBackward,
  hasClipboardContent,
} from '../services/clipboardService';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

const MenuItem: React.FC<MenuItemProps> = ({ icon, label, shortcut, disabled, danger, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`flex w-full items-center gap-3 px-3 py-2 text-left text-xs transition-colors ${
      disabled
        ? 'cursor-not-allowed text-[color:var(--ui-panel-text)]/60'
        : danger
        ? 'text-red-400 hover:bg-red-500/10'
        : 'text-[color:var(--ui-text)] hover:bg-white/10'
    }`}
  >
    <span className="w-4 h-4 flex-shrink-0">{icon}</span>
    <span className="flex-1 uppercase tracking-widest">{label}</span>
    {shortcut && (
      <span className="text-[10px] text-[color:var(--ui-panel-text)]/60 uppercase tracking-wider">{shortcut}</span>
    )}
  </button>
);

const MenuDivider: React.FC = () => <div className="my-1 h-px bg-white/10" />;

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);

  const {
    canvas,
    selectedObjectId,
    removeSelectedObject,
    toggleMovementLock,
    toggleObjectLock,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      selectedObjectId: state.selectedObjectId,
      removeSelectedObject: state.removeSelectedObject,
      toggleMovementLock: state.toggleMovementLock,
      toggleObjectLock: state.toggleObjectLock,
    }),
    shallow
  );

  const activeObject = canvas?.getActiveObject();
  const hasSelection = !!activeObject;
  const hasClipboard = hasClipboardContent();
  const isLocked = activeObject ? !!(activeObject as any).lockMovementX : false;
  const isSelectionLocked = activeObject ? (activeObject as any).selectable === false : false;

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to keep menu within viewport
  const adjustedPosition = useCallback(() => {
    const menuWidth = 200;
    const menuHeight = 320;
    const padding = 8;

    let adjustedX = x;
    let adjustedY = y;

    if (x + menuWidth > window.innerWidth - padding) {
      adjustedX = window.innerWidth - menuWidth - padding;
    }

    if (y + menuHeight > window.innerHeight - padding) {
      adjustedY = window.innerHeight - menuHeight - padding;
    }

    return { x: Math.max(padding, adjustedX), y: Math.max(padding, adjustedY) };
  }, [x, y]);

  const position = adjustedPosition();

  const handleCopy = async () => {
    await copySelection();
    onClose();
  };

  const handlePaste = async () => {
    await pasteFromClipboard();
    onClose();
  };

  const handleDuplicate = async () => {
    await duplicateSelection();
    onClose();
  };

  const handleDelete = () => {
    removeSelectedObject();
    onClose();
  };

  const handleBringToFront = () => {
    bringToFront();
    onClose();
  };

  const handleSendToBack = () => {
    sendToBack();
    onClose();
  };

  const handleBringForward = () => {
    bringForward();
    onClose();
  };

  const handleSendBackward = () => {
    sendBackward();
    onClose();
  };

  const handleToggleLock = () => {
    const targetId = selectedObjectId || ((activeObject as any)?.id as string | undefined);
    if (targetId) {
      toggleMovementLock(targetId);
    }
    onClose();
  };

  const handleToggleSelectionLock = () => {
    const targetId = selectedObjectId || ((activeObject as any)?.id as string | undefined);
    if (targetId && canvas) {
      const obj = canvas.getObjects().find((o) => (o as any).id === targetId);
      if (obj) {
        canvas.setActiveObject(obj);
      }
      useEditorStore.getState().setSelectedObjectId(targetId);
      toggleObjectLock();
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] min-w-[180px] rounded-xl border border-white/10 bg-[color:var(--ui-bg)] py-1 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {/* Clipboard Actions */}
      <MenuItem
        icon={<Copy className="w-4 h-4 stroke-[1.5]" />}
        label="Copy"
        shortcut="⌘C"
        disabled={!hasSelection}
        onClick={handleCopy}
      />
      <MenuItem
        icon={<Clipboard className="w-4 h-4 stroke-[1.5]" />}
        label="Paste"
        shortcut="⌘V"
        disabled={!hasClipboard}
        onClick={handlePaste}
      />
      <MenuItem
        icon={<CopyPlus className="w-4 h-4 stroke-[1.5]" />}
        label="Duplicate"
        shortcut="⌘D"
        disabled={!hasSelection}
        onClick={handleDuplicate}
      />

      <MenuDivider />

      {/* Z-Index Actions */}
      <MenuItem
        icon={<ArrowUpToLine className="w-4 h-4 stroke-[1.5]" />}
        label="Bring to Front"
        disabled={!hasSelection}
        onClick={handleBringToFront}
      />
      <MenuItem
        icon={<ArrowUp className="w-4 h-4 stroke-[1.5]" />}
        label="Bring Forward"
        disabled={!hasSelection}
        onClick={handleBringForward}
      />
      <MenuItem
        icon={<ArrowDown className="w-4 h-4 stroke-[1.5]" />}
        label="Send Backward"
        disabled={!hasSelection}
        onClick={handleSendBackward}
      />
      <MenuItem
        icon={<ArrowDownToLine className="w-4 h-4 stroke-[1.5]" />}
        label="Send to Back"
        disabled={!hasSelection}
        onClick={handleSendToBack}
      />

      <MenuDivider />

      {/* Object Actions */}
      <MenuItem
        icon={isLocked ? <Unlock className="w-4 h-4 stroke-[1.5]" /> : <Lock className="w-4 h-4 stroke-[1.5]" />}
        label={isLocked ? 'Unlock Position' : 'Lock Position'}
        disabled={!hasSelection}
        onClick={handleToggleLock}
      />

      <MenuDivider />

      <MenuItem
        icon={isSelectionLocked ? <Unlock className="w-4 h-4 stroke-[1.5]" /> : <Lock className="w-4 h-4 stroke-[1.5]" />}
        label={isSelectionLocked ? 'Unlock Selection' : 'Lock Selection'}
        disabled={!hasSelection}
        onClick={handleToggleSelectionLock}
      />

      <MenuDivider />

      <MenuItem
        icon={<Trash2 className="w-4 h-4 stroke-[1.5]" />}
        label="Delete"
        shortcut="⌫"
        disabled={!hasSelection}
        danger
        onClick={handleDelete}
      />
    </div>
  );
};

// Hook to manage context menu state
export const useContextMenu = () => {
  const [contextMenu, setContextMenu] = React.useState<{ x: number; y: number } | null>(null);

  const showContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  const hideContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return {
    contextMenu,
    showContextMenu,
    hideContextMenu,
  };
};
