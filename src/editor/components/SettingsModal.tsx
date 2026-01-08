import React, { useRef } from 'react';
import { X, Upload } from 'lucide-react';
import { UI_THEME_PRESETS, useUiThemeStore } from '../state/uiThemeStore';
import type { ApocapaletteTheme } from '../types/apocapalette';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { applyThemeFromTokens, applyPreset, activePresetId } = useUiThemeStore();

  if (!isOpen) return null;

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result;
      if (typeof text === 'string') {
        try {
          const json = JSON.parse(text) as ApocapaletteTheme;
          applyThemeFromTokens(json);
        } catch {
          // ignore invalid theme payloads
        }
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[color:var(--ui-panel)] rounded-lg shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col border border-[color:var(--ui-border)] backdrop-blur-[var(--ui-blur)] text-slate-100">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--ui-border)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-100">Vibe Settings</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out">
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          <section className="space-y-4">
            <h3 className="text-sm uppercase tracking-widest text-slate-200">Import UI Theme</h3>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              className="hidden"
            />
            <button
              type="button"
              onClick={handleImportClick}
              className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 text-slate-100 rounded-lg hover:bg-white/20 text-xs uppercase tracking-widest"
            >
              <Upload className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)]" />
              Import UI Theme
            </button>
          </section>

          <section className="space-y-4">
            <h3 className="text-sm uppercase tracking-widest text-slate-200">Preset Vibes</h3>
            <div className="grid grid-cols-3 gap-3">
              {UI_THEME_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => applyPreset(preset.id)}
                  className={`rounded-xl border px-4 py-4 text-left transition-all duration-300 ease-in-out ${
                    activePresetId === preset.id
                      ? 'border-[color:var(--brand-primary)] bg-white/15'
                      : 'border-[color:var(--ui-border)] bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div
                    className="h-20 rounded-lg mb-3"
                    style={{
                      background: preset.vars['--ui-bg'],
                      border: `1px solid ${preset.vars['--ui-border']}`,
                    }}
                  >
                    <div
                      className="h-full w-full rounded-lg"
                      style={{
                        background: preset.vars['--ui-panel'],
                        border: `1px solid ${preset.vars['--ui-border']}`,
                      }}
                    />
                  </div>
                  <div className="text-xs uppercase tracking-widest text-slate-100">{preset.name}</div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-300">{preset.description}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
