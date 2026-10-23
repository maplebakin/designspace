import React from 'react';
import * as fabric from 'fabric';
import {
  type TarotPositionMetadata,
  updateTarotGroupContents,
} from '../tarot/spreadCanvas';

interface TarotPositionInspectorProps {
  object: fabric.Group;
  onUpdate: (updates: Record<string, unknown>) => void;
}

/** Inspector for card-specific interpretation, independent of placement/rotation. */
export const TarotPositionInspector: React.FC<TarotPositionInspectorProps> = ({ object, onUpdate }) => {
  const metadata = (object as any).tarotPosition as TarotPositionMetadata;
  const objectId = (object as any).id as string;

  const commit = (field: 'label' | 'prompt', rawValue: string) => {
    const current = (object as any).tarotPosition as TarotPositionMetadata;
    const value = rawValue.trim().slice(0, field === 'label' ? 80 : 500);
    if (current[field] === value) return;
    const updated = { ...current, [field]: value };
    updateTarotGroupContents(object, updated);
    onUpdate({
      tarotPosition: updated,
      name: `Tarot · ${updated.number}: ${updated.label}`,
      dirty: true,
    });
  };

  return (
    <section className="space-y-3 rounded-xl border border-[color:var(--border-subtle)] bg-white/5 p-3">
      <div>
        <h3 className="text-xs font-semibold text-[color:var(--ui-text)]">Tarot position {metadata.number}</h3>
        <p className="text-[10px] text-[color:var(--ui-panel-text)]">
          Move and rotate the card on canvas. Edit the meaning here.
        </p>
      </div>
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Position label</span>
        <input
          key={`${objectId}-label`}
          aria-label="Tarot position label"
          defaultValue={metadata.label}
          maxLength={80}
          onBlur={(event) => commit('label', event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          className="w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Reflection question</span>
        <textarea
          key={`${objectId}-prompt`}
          aria-label="Tarot reflection question"
          defaultValue={metadata.prompt}
          maxLength={500}
          rows={3}
          onBlur={(event) => commit('prompt', event.currentTarget.value)}
          className="w-full resize-y rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
        />
      </label>
      <p className="text-[10px] text-[color:var(--ui-panel-text)]">
        The card face shows a short label. The full question is stored with this editable position.
      </p>
    </section>
  );
};
