import React, { useCallback, useRef } from 'react';
import Draggable, { DraggableEvent, DraggableData } from 'react-draggable';
import { Trash2, Copy, Image, Palette, Layout } from 'lucide-react';
import type { VisionItem } from '../state/visionBoardStore';

interface BoardItemProps {
  item: VisionItem;
  isSelected: boolean;
  zoom: number;
  onSelect: (id: string, additive: boolean) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onDoubleClick?: (item: VisionItem) => void;
  onDelete?: (id: string) => void;
  onDuplicate?: (id: string) => void;
}

export const BoardItem: React.FC<BoardItemProps> = ({
  item,
  isSelected,
  zoom,
  onSelect,
  onPositionChange,
  onDoubleClick,
  onDelete,
  onDuplicate,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleStart = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleDrag = useCallback(() => {
    isDragging.current = true;
  }, []);

  const handleStop = useCallback(
    (_e: DraggableEvent, data: DraggableData) => {
      if (isDragging.current) {
        onPositionChange(item.id, data.x, data.y);
      }
    },
    [item.id, onPositionChange]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) {
        onSelect(item.id, e.shiftKey || e.metaKey || e.ctrlKey);
      }
    },
    [item.id, onSelect]
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDoubleClick) {
        onDoubleClick(item);
      }
    },
    [item, onDoubleClick]
  );

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDelete) {
        onDelete(item.id);
      }
    },
    [item.id, onDelete]
  );

  const handleDuplicate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (onDuplicate) {
        onDuplicate(item.id);
      }
    },
    [item.id, onDuplicate]
  );

  const renderItemContent = () => {
    switch (item.type) {
      case 'image':
        return (
          <div className="w-full h-full overflow-hidden rounded-lg">
            <img
              src={item.thumbnail || item.src}
              alt={item.label || 'Vision board image'}
              className="w-full h-full object-cover"
              draggable={false}
            />
          </div>
        );

      case 'color':
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div
              className="rounded-full shadow-lg border-4 border-white/20"
              style={{
                backgroundColor: item.hex,
                width: Math.min(item.position.width, item.position.height) * 0.8,
                height: Math.min(item.position.width, item.position.height) * 0.8,
              }}
            />
          </div>
        );

      case 'design-state':
        return (
          <div className="w-full h-full overflow-hidden rounded-lg bg-white/5">
            {item.thumbnail ? (
              <img
                src={item.thumbnail}
                alt={item.label || 'Design snapshot'}
                className="w-full h-full object-contain"
                draggable={false}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Layout className="w-8 h-8 opacity-30" />
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  const getTypeIcon = () => {
    switch (item.type) {
      case 'image':
        return <Image className="w-3 h-3" />;
      case 'color':
        return <Palette className="w-3 h-3" />;
      case 'design-state':
        return <Layout className="w-3 h-3" />;
      default:
        return null;
    }
  };

  return (
    <Draggable
      nodeRef={nodeRef}
      position={{ x: item.position.x, y: item.position.y }}
      scale={zoom}
      onStart={handleStart}
      onDrag={handleDrag}
      onStop={handleStop}
      bounds={false}
    >
      <div
        ref={nodeRef}
        className={`
          absolute group cursor-move
          transition-shadow duration-200
          ${isSelected ? 'ring-2 ring-[color:var(--brand-primary)] ring-offset-2 ring-offset-transparent' : ''}
        `}
        style={{
          width: item.position.width,
          height: item.position.height,
          zIndex: item.position.zIndex ?? 0,
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {/* Main content */}
        <div
          className={`
            w-full h-full rounded-xl overflow-hidden
            bg-[color:var(--ui-panel)] border border-[color:var(--ui-border)]
            shadow-lg hover:shadow-xl transition-all duration-200
            ${isSelected ? 'border-[color:var(--brand-primary)]' : ''}
          `}
        >
          {renderItemContent()}
        </div>

        {/* Label badge */}
        {item.label && (
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-[color:var(--ui-panel)] border border-[color:var(--ui-border)] rounded-full text-xs text-[color:var(--ui-text)] whitespace-nowrap max-w-full truncate shadow-md">
            {item.label}
          </div>
        )}

        {/* Type indicator */}
        <div className="absolute top-2 left-2 p-1 bg-black/50 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity">
          {getTypeIcon()}
        </div>

        {/* Action buttons */}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onDuplicate && (
            <button
              onClick={handleDuplicate}
              className="p-1.5 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
              title="Duplicate"
            >
              <Copy className="w-3 h-3 text-white" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-full bg-black/50 hover:bg-red-500/70 transition-colors"
              title="Delete"
            >
              <Trash2 className="w-3 h-3 text-white" />
            </button>
          )}
        </div>

        {/* Double-click hint for design states */}
        {item.type === 'design-state' && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-black/60 rounded text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
            Double-click to load
          </div>
        )}

        {/* Color hex label for color items */}
        {item.type === 'color' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-white font-mono opacity-0 group-hover:opacity-100 transition-opacity">
            {item.hex.toUpperCase()}
          </div>
        )}
      </div>
    </Draggable>
  );
};

export default BoardItem;
