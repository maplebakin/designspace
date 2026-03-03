import React from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import type { UnitMode } from '../utils/units';

const UNIT_OPTIONS: UnitMode[] = ['px', 'in', 'mm'];

export const CanvasSettingsPanel: React.FC = () => {
  const { unitMode, showSafeZones, setUnitMode, setShowSafeZones } = useEditorStore(
    (state) => ({
      unitMode: state.unitMode,
      showSafeZones: state.showSafeZones,
      setUnitMode: state.setUnitMode,
      setShowSafeZones: state.setShowSafeZones,
    }),
    shallow
  );

  return (
    <section
      className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-4 shadow-lg backdrop-blur-[var(--ui-blur)]"
      aria-label="Canvas settings"
    >
      <div className="mb-3">
        <h3 className="text-xs uppercase tracking-[0.25em] text-[color:var(--ui-panel-text)]/70">Canvas</h3>
      </div>
      <label className="mb-3 block text-xs text-[color:var(--ui-panel-text)]">
        Unit mode
        <select
          value={unitMode}
          onChange={(event) => setUnitMode(event.target.value as UnitMode)}
          className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"
          aria-label="Select canvas unit mode"
        >
          {UNIT_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center justify-between gap-3 text-xs text-[color:var(--ui-panel-text)]">
        <span>Safe zones</span>
        <button
          type="button"
          onClick={() => setShowSafeZones(!showSafeZones)}
          aria-pressed={showSafeZones}
          className={`h-6 w-11 rounded-full border transition-colors ${
            showSafeZones
              ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/50'
              : 'border-white/10 bg-black/20'
          }`}
        >
          <span
            className={`block h-5 w-5 rounded-full bg-white transition-transform ${
              showSafeZones ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </label>
    </section>
  );
};
