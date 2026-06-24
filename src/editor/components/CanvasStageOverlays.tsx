import React, { useState } from 'react';
import { FileText, Image, Monitor, Printer, Settings2, Smartphone, Square } from 'lucide-react';
import { PRINT_DPI } from '../utils/units';
import { CanvasSettingsPanel } from './CanvasSettingsPanel';
import { SuggestionSidebar } from './SuggestionSidebar';
import { AccessibilityPanel } from './AccessibilityPanel';
import { useEditorStore } from '../state/editorStore';
import type { UnitMode } from '../utils/units';

type SizePreset = {
  id: string;
  name: string;
  description: string;
  width: number;
  height: number;
  icon: React.ReactNode;
  category: 'print' | 'digital';
  recommended?: boolean;
};

const SIZE_PRESETS: SizePreset[] = [
  { id: 'us-letter', name: 'US Letter', description: '8.5" × 11"', width: Math.round(8.5 * PRINT_DPI), height: Math.round(11 * PRINT_DPI), icon: <FileText className="w-5 h-5" />, category: 'print', recommended: true },
  { id: 'a4', name: 'A4', description: '210 × 297 mm', width: 2480, height: 3508, icon: <FileText className="w-5 h-5" />, category: 'print' },
  { id: 'a5', name: 'A5', description: '148 × 210 mm', width: 1748, height: 2480, icon: <FileText className="w-5 h-5" />, category: 'print' },
  { id: 'postcard', name: 'Postcard', description: '4" × 6"', width: Math.round(4 * PRINT_DPI), height: Math.round(6 * PRINT_DPI), icon: <Image className="w-5 h-5" />, category: 'print' },
  { id: 'instagram-square', name: 'Instagram', description: '1080 × 1080', width: 1080, height: 1080, icon: <Square className="w-5 h-5" />, category: 'digital' },
  { id: 'instagram-story', name: 'Story', description: '1080 × 1920', width: 1080, height: 1920, icon: <Smartphone className="w-5 h-5" />, category: 'digital' },
  { id: 'hd', name: 'HD', description: '1920 × 1080', width: 1920, height: 1080, icon: <Monitor className="w-5 h-5" />, category: 'digital' },
  { id: '4k', name: '4K', description: '3840 × 2160', width: 3840, height: 2160, icon: <Monitor className="w-5 h-5" />, category: 'digital' },
];

type CanvasSizePickerProps = {
  onSelect: (width: number, height: number, unitMode: UnitMode) => void;
  onDismiss: () => void;
};

export const CanvasSizePicker: React.FC<CanvasSizePickerProps> = ({ onSelect, onDismiss }) => {
  const [showCustom, setShowCustom] = useState(false);
  const [customWidth, setCustomWidth] = useState('8.5');
  const [customHeight, setCustomHeight] = useState('11');
  const [customUnit, setCustomUnit] = useState<'in' | 'px'>('in');

  const printPresets = SIZE_PRESETS.filter((preset) => preset.category === 'print');
  const digitalPresets = SIZE_PRESETS.filter((preset) => preset.category === 'digital');

  const handleCustomApply = () => {
    const width = parseFloat(customWidth);
    const height = parseFloat(customHeight);
    if (Number.isNaN(width) || Number.isNaN(height) || width <= 0 || height <= 0) {
      return;
    }
    const widthPx = customUnit === 'in' ? Math.round(width * PRINT_DPI) : Math.round(width);
    const heightPx = customUnit === 'in' ? Math.round(height * PRINT_DPI) : Math.round(height);
    onSelect(widthPx, heightPx, customUnit);
  };

  const getPreviewAspect = (preset: SizePreset) => {
    const maxSize = 48;
    const aspect = preset.width / preset.height;
    if (aspect > 1) {
      return { width: maxSize, height: Math.round(maxSize / aspect) };
    }
    return { width: Math.round(maxSize * aspect), height: maxSize };
  };

  return (
    <div className="canvas-size-picker-overlay absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
      <div className="canvas-size-picker-panel pointer-events-auto flex max-w-2xl flex-col gap-6 rounded-3xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] px-8 py-7 backdrop-blur-[var(--ui-blur)]" style={{ boxShadow: 'var(--modal-shadow)' }}>
        <div className="canvas-size-picker-header space-y-1 text-center">
          <h2 className="text-lg font-medium text-[color:var(--ui-panel-text)]">New Canvas</h2>
          <p className="text-xs text-[color:var(--ui-panel-text)]/60">Choose a size to get started</p>
        </div>
        <div className="canvas-size-picker-sections space-y-5">
          <div className="canvas-size-picker-section space-y-2">
            <div className="canvas-size-picker-section-title flex items-center gap-2 text-[color:var(--ui-panel-text)]/70">
              <Printer className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-widest">Print (300 DPI)</span>
            </div>
            <div className="canvas-size-picker-grid grid grid-cols-4 gap-2">
              {printPresets.map((preset) => {
                const preview = getPreviewAspect(preset);
                return (
                  <button
                    key={preset.id}
                    data-testid={`project-preset-${preset.id}`}
                    onClick={() => onSelect(preset.width, preset.height, 'in')}
                    className={`canvas-size-picker-card group relative flex flex-col items-center gap-2 rounded-xl border p-3 transition-all duration-200 ${
                      preset.recommended
                        ? 'canvas-size-picker-card-recommended border-[color:var(--brand-primary)]/50 bg-[color:var(--brand-primary)]/10 hover:bg-[color:var(--brand-primary)]/20'
                        : 'border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] hover:border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--ui-surface-strong)]'
                    }`}
                  >
                    {preset.recommended && (
                      <span className="canvas-size-picker-badge absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-[color:var(--brand-primary)] px-2 py-0.5 text-[8px] uppercase tracking-wider text-white">
                        Default
                      </span>
                    )}
                    <div
                      className="canvas-size-picker-preview rounded-sm border border-[color:var(--ui-panel-text)]/20 bg-white/90"
                      style={{ width: preview.width, height: preview.height }}
                    />
                    <div className="canvas-size-picker-card-copy text-center">
                      <div className={`canvas-size-picker-card-name text-xs font-medium ${preset.recommended ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)]'}`}>
                        {preset.name}
                      </div>
                      <div className="canvas-size-picker-card-description text-[10px] text-[color:var(--ui-panel-text)]/50">{preset.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="canvas-size-picker-section space-y-2">
            <div className="canvas-size-picker-section-title flex items-center gap-2 text-[color:var(--ui-panel-text)]/70">
              <Monitor className="h-3.5 w-3.5" />
              <span className="text-[10px] uppercase tracking-widest">Digital</span>
            </div>
            <div className="canvas-size-picker-grid grid grid-cols-4 gap-2">
              {digitalPresets.map((preset) => {
                const preview = getPreviewAspect(preset);
                return (
                  <button
                    key={preset.id}
                    data-testid={`project-preset-${preset.id}`}
                    onClick={() => onSelect(preset.width, preset.height, 'px')}
                    className="canvas-size-picker-card group flex flex-col items-center gap-2 rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] p-3 transition-all duration-200 hover:border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--ui-surface-strong)]"
                  >
                    <div
                      className="canvas-size-picker-preview rounded-sm border border-[color:var(--ui-panel-text)]/20 bg-white/90"
                      style={{ width: preview.width, height: preview.height }}
                    />
                    <div className="canvas-size-picker-card-copy text-center">
                      <div className="canvas-size-picker-card-name text-xs font-medium text-[color:var(--ui-panel-text)]">{preset.name}</div>
                      <div className="canvas-size-picker-card-description text-[10px] text-[color:var(--ui-panel-text)]/50">{preset.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="canvas-size-picker-custom border-t border-[color:var(--ui-border)] pt-2">
            {showCustom ? (
              <div className="canvas-size-picker-custom-form space-y-3">
                <div className="canvas-size-picker-custom-fields flex items-center gap-3">
                  <div className="flex-1 space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Width</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={customWidth}
                      onChange={(event) => setCustomWidth(event.target.value)}
                      className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2 text-sm text-[color:var(--ui-panel-text)] outline-none focus:border-[color:var(--brand-primary)]"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Height</label>
                    <input
                      type="number"
                      step="0.1"
                      min="1"
                      value={customHeight}
                      onChange={(event) => setCustomHeight(event.target.value)}
                      className="w-full rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2 text-sm text-[color:var(--ui-panel-text)] outline-none focus:border-[color:var(--brand-primary)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/50">Unit</label>
                    <select
                      value={customUnit}
                      onChange={(event) => setCustomUnit(event.target.value as 'in' | 'px')}
                      className="rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-3 py-2 text-sm text-[color:var(--ui-panel-text)] outline-none focus:border-[color:var(--brand-primary)]"
                    >
                      <option value="in">inches</option>
                      <option value="px">pixels</option>
                    </select>
                  </div>
                </div>
                <div className="canvas-size-picker-custom-actions flex gap-2">
                  <button
                    onClick={() => setShowCustom(false)}
                    className="flex-1 rounded-lg bg-[color:var(--ui-surface-soft)] px-4 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 transition-colors hover:bg-[color:var(--ui-surface-strong)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCustomApply}
                    className="flex-1 rounded-lg bg-[color:var(--brand-primary)] px-4 py-2 text-xs uppercase tracking-widest text-white transition-all hover:brightness-110"
                  >
                    Create Canvas
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCustom(true)}
                className="canvas-size-picker-custom-toggle flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[color:var(--ui-border)] px-4 py-3 text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]/70 transition-all hover:border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--ui-surface-soft)] hover:text-[color:var(--ui-panel-text)]"
              >
                <Settings2 className="h-4 w-4" />
                Custom Size
              </button>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="canvas-size-picker-dismiss text-xs text-[color:var(--ui-panel-text)]/40 transition-colors hover:text-[color:var(--ui-panel-text)]/70"
        >
          Skip and use default (US Letter)
        </button>
      </div>
    </div>
  );
};

type CanvasSyncErrorOverlayProps = {
  syncError: string | null;
  onDownloadProject: () => void;
  onReload: () => void;
  onDismiss: () => void;
};

export const CanvasSyncErrorOverlay: React.FC<CanvasSyncErrorOverlayProps> = ({
  syncError,
  onDownloadProject,
  onReload,
  onDismiss,
}) => {
  if (!syncError) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-2xl border border-red-500/30 bg-white px-8 py-6 text-center shadow-xl">
        <div className="flex items-center gap-2 text-red-600">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h3 className="text-lg font-semibold">Canvas Synchronization Error</h3>
        </div>
        <p className="text-sm text-[color:var(--ui-panel-text)]/60">{syncError}</p>
        <div className="flex gap-3">
          <button
            onClick={onDownloadProject}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Download Project
          </button>
          <button
            onClick={onReload}
            className="rounded-lg bg-[color:var(--ui-panel-opaque)] px-4 py-2 text-sm font-medium text-[color:var(--ui-text)] transition-colors hover:bg-[color:var(--ui-panel)]"
          >
            Reload Page
          </button>
          <button
            onClick={onDismiss}
            className="rounded-lg border border-[color:var(--ui-border)] px-4 py-2 text-sm font-medium text-[color:var(--ui-panel-text)]/60 transition-colors hover:bg-[color:var(--ui-panel)]"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};

export const CanvasStagePanels: React.FC = () => {
  const showCanvasSettingsPanel = useEditorStore((state) => state.showCanvasSettingsPanel);
  const toggleCanvasSettingsPanel = useEditorStore((state) => state.toggleCanvasSettingsPanel);
  const hasCanvasContent = useEditorStore((state) => state.canvasObjects.length > 0);
  const showSuggestionSidebar = useEditorStore((state) => state.showSuggestionSidebar);
  const toggleSuggestionSidebar = useEditorStore((state) => state.toggleSuggestionSidebar);

  return (
    <>
      {showCanvasSettingsPanel ? (
        <div className="pointer-events-none absolute left-4 top-4 z-30 w-64">
          <div className="pointer-events-auto">
            <CanvasSettingsPanel />
          </div>
        </div>
      ) : null}
      {showSuggestionSidebar ? (
        <div className="pointer-events-none absolute right-4 top-4 z-30 hidden w-72 flex-col gap-3 md:flex">
          <div className="pointer-events-auto">
            <SuggestionSidebar />
          </div>
          <div className="pointer-events-auto">
            <AccessibilityPanel />
          </div>
        </div>
      ) : hasCanvasContent ? (
        <div className="pointer-events-none absolute inset-0 z-30 hidden md:block">
          <div className="pointer-events-none absolute left-4 top-4">
            <button
              type="button"
              onClick={() => {
                if (!showCanvasSettingsPanel) {
                  toggleCanvasSettingsPanel();
                }
                toggleSuggestionSidebar();
              }}
              className="pointer-events-auto rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] shadow-lg backdrop-blur-[var(--ui-blur)] hover:bg-[color:var(--ui-panel)]"
            >
              Show Panels
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
};
