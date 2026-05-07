import React from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import {
  AlignCenter,
  AlignCenterVertical,
  AlignHorizontalDistributeCenter,
  AlignLeft,
  AlignRight,
  AlignStartVertical,
  AlignEndVertical,
  AlignVerticalDistributeCenter,
  Group,
  Ungroup,
  CopyPlus,
  Trash2,
  ArrowUpToLine,
  ArrowDownToLine,
} from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { isActiveSelection as isActiveSelectionObject } from '../utils/typeGuards';
import { Tooltip } from './Tooltip';
import { duplicateSelection, bringToFront, sendToBack } from '../services/clipboardService';

type ToolbarButtonProps = {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
};

const ToolbarButton = ({ label, disabled, onClick, children }: ToolbarButtonProps) => (
  <Tooltip content={label} side="bottom">
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-400/20 text-indigo-100 transition-all duration-200 hover:border-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/10 hover:scale-110 active:scale-95 disabled:cursor-not-allowed disabled:border-[color:var(--ui-border)] disabled:text-[color:var(--ui-panel-text)]/60 disabled:hover:scale-100 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  </Tooltip>
);

export const SelectionToolbar: React.FC = () => {
  const {
    canvas,
    selectedObjectId,
    selectedLayerIds,
    alignSelectedObjects,
    distributeSelectedObjects,
    groupSelectedObjects,
    ungroupSelectedObjects,
    removeSelectedObject,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      selectedObjectId: state.selectedObjectId,
      selectedLayerIds: state.selectedLayerIds,
      alignSelectedObjects: state.alignSelectedObjects,
      distributeSelectedObjects: state.distributeSelectedObjects,
      groupSelectedObjects: state.groupSelectedObjects,
      ungroupSelectedObjects: state.ungroupSelectedObjects,
      removeSelectedObject: state.removeSelectedObject,
    }),
    shallow
  );

  if (!canvas) return null;
  const selectedObjects = selectedLayerIds
    .map((id) => canvas.getObjects().find((obj) => (obj as any).id === id))
    .filter((obj): obj is fabric.Object => !!obj);
  const activeObject = selectedObjects.length > 1
    ? canvas.getActiveObject()
    : (selectedObjectId ? selectedObjects[0] : canvas.getActiveObject());
  if (!activeObject && selectedObjects.length === 0) return null;

  const isActiveSelection = isActiveSelectionObject(activeObject) || selectedObjects.length > 1;
  const isGroup = activeObject?.type === 'group';
  const isSingleObject = !isActiveSelection;
  const selectionCount = selectedLayerIds.length;
  const canGroup = isActiveSelection && selectionCount > 1;
  const canUngroup = isGroup && selectionCount === 1;
  const canAlign = isActiveSelection;
  const canDistribute = isActiveSelection && selectionCount >= 3;

  const handleGroupToggle = () => {
    if (canUngroup) {
      ungroupSelectedObjects();
      return;
    }
    if (canGroup) {
      groupSelectedObjects();
    }
  };

  const handleDuplicate = async () => {
    await duplicateSelection();
  };

  const handleDelete = () => {
    removeSelectedObject();
  };

  const handleBringToFront = () => {
    bringToFront();
  };

  const handleSendToBack = () => {
    sendToBack();
  };

  // Single object toolbar - compact quick actions
  if (isSingleObject) {
    return (
      <div className="pointer-events-auto absolute left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-indigo-500/30 bg-[color:var(--ui-panel-opaque)] px-3 py-2 text-xs uppercase tracking-widest text-indigo-100 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-md">
        <ToolbarButton label="Duplicate (⌘D)" onClick={handleDuplicate}>
          <CopyPlus className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>

        <div className="h-6 w-px bg-indigo-500/30 mx-1" />

        <ToolbarButton label="Bring to Front" onClick={handleBringToFront}>
          <ArrowUpToLine className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton label="Send to Back" onClick={handleSendToBack}>
          <ArrowDownToLine className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>

        <div className="h-6 w-px bg-indigo-500/30 mx-1" />

        <ToolbarButton label="Delete (⌫)" onClick={handleDelete}>
          <Trash2 className="h-4 w-4 stroke-[1.5] text-red-400" />
        </ToolbarButton>
      </div>
    );
  }

  // Multi-selection toolbar - alignment and distribution
  return (
    <div className="pointer-events-auto absolute left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-indigo-500/30 bg-[color:var(--ui-panel-opaque)] px-3 py-2 text-xs uppercase tracking-widest text-indigo-100 shadow-[0_12px_30px_rgba(0,0,0,0.45)] backdrop-blur-md">
      {/* Quick Actions */}
      <ToolbarButton label="Duplicate (⌘D)" onClick={handleDuplicate}>
        <CopyPlus className="h-4 w-4 stroke-[1.5]" />
      </ToolbarButton>

      <div className="h-6 w-px bg-indigo-500/30" />

      <ToolbarButton
        label={canUngroup ? 'Ungroup' : 'Group'}
        disabled={!canGroup && !canUngroup}
        onClick={handleGroupToggle}
      >
        {canUngroup ? <Ungroup className="h-4 w-4 stroke-[1.5]" /> : <Group className="h-4 w-4 stroke-[1.5]" />}
      </ToolbarButton>

      <div className="h-6 w-px bg-indigo-500/30" />

      <div className="flex items-center gap-1">
        <ToolbarButton label="Align Left" disabled={!canAlign} onClick={() => alignSelectedObjects('left')}>
          <AlignLeft className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton label="Align Center" disabled={!canAlign} onClick={() => alignSelectedObjects('center')}>
          <AlignCenter className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton label="Align Right" disabled={!canAlign} onClick={() => alignSelectedObjects('right')}>
          <AlignRight className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
      </div>

      <div className="flex items-center gap-1">
        <ToolbarButton label="Align Top" disabled={!canAlign} onClick={() => alignSelectedObjects('top')}>
          <AlignStartVertical className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton label="Align Middle" disabled={!canAlign} onClick={() => alignSelectedObjects('middle')}>
          <AlignCenterVertical className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton label="Align Bottom" disabled={!canAlign} onClick={() => alignSelectedObjects('bottom')}>
          <AlignEndVertical className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
      </div>

      <div className="h-6 w-px bg-indigo-500/30" />

      <div className="flex items-center gap-1">
        <ToolbarButton
          label="Distribute Horizontal"
          disabled={!canDistribute}
          onClick={() => distributeSelectedObjects('horizontal')}
        >
          <AlignHorizontalDistributeCenter className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
        <ToolbarButton
          label="Distribute Vertical"
          disabled={!canDistribute}
          onClick={() => distributeSelectedObjects('vertical')}
        >
          <AlignVerticalDistributeCenter className="h-4 w-4 stroke-[1.5]" />
        </ToolbarButton>
      </div>

      <div className="h-6 w-px bg-indigo-500/30" />

      <ToolbarButton label="Delete (⌫)" onClick={handleDelete}>
        <Trash2 className="h-4 w-4 stroke-[1.5] text-red-400" />
      </ToolbarButton>
    </div>
  );
};
