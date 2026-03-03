import React from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';

export const AccessibilityPanel: React.FC = () => {
  const { accessibilitySettings, updateAccessibilitySettings } = useEditorStore(
    (state) => ({
      accessibilitySettings: state.accessibilitySettings,
      updateAccessibilitySettings: state.updateAccessibilitySettings,
    }),
    shallow
  );

  return (
    <section
      className="rounded-2xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel-opaque)] p-4 shadow-lg backdrop-blur-[var(--ui-blur)]"
      aria-label="Accessibility settings"
    >
      <div className="mb-3">
        <h3 className="text-xs uppercase tracking-[0.25em] text-[color:var(--ui-panel-text)]/70">Accessibility</h3>
      </div>
      <div className="space-y-2">
        <ToggleRow
          label="High contrast"
          checked={accessibilitySettings.mode === 'high-contrast'}
          onChange={(checked) => updateAccessibilitySettings({ mode: checked ? 'high-contrast' : 'standard' })}
        />
        <ToggleRow
          label="Dyslexia-friendly font"
          checked={accessibilitySettings.dyslexiaFont}
          onChange={(checked) => updateAccessibilitySettings({
            mode: checked ? 'dyslexia-friendly' : 'standard',
            dyslexiaFont: checked,
          })}
        />
        <ToggleRow
          label="Reduced motion"
          checked={accessibilitySettings.reduceMotion}
          onChange={(checked) => updateAccessibilitySettings({
            mode: checked ? 'reduced-motion' : 'standard',
            reduceMotion: checked,
            skipAnimations: checked,
          })}
        />
        <ToggleRow
          label="Large text"
          checked={accessibilitySettings.mode === 'large-text'}
          onChange={(checked) => updateAccessibilitySettings({
            mode: checked ? 'large-text' : 'standard',
            fontSizeMultiplier: checked ? 1.25 : 1,
          })}
        />
      </div>
    </section>
  );
};

const ToggleRow = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <label className="flex items-center justify-between gap-3 text-xs text-[color:var(--ui-panel-text)]">
    <span>{label}</span>
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`h-6 w-11 rounded-full border transition-colors ${
        checked
          ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/50'
          : 'border-white/10 bg-black/20'
      }`}
    >
      <span
        className={`block h-5 w-5 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  </label>
);
