import React, { useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { insertTarotSpread } from '../tarot/spreadCanvas';
import {
  makeTarotPositions,
  getTarotPresetsForCount,
  TAROT_PRESETS,
  updateTarotPosition,
  type TarotPresetId,
} from '../tarot/spreadPresets';

export const TarotSpreadPanel: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<TarotPresetId>('template-3');
  const [cardCount, setCardCount] = useState(3);
  const [title, setTitle] = useState('The Fork in the Road');
  const [positions, setPositions] = useState(() => makeTarotPositions('template-3'));
  const canvasReady = useEditorStore((state) => !!state.canvas);

  const choosePreset = (value: TarotPresetId, count = cardCount) => {
    const previousDefaultTitle = TAROT_PRESETS.find((item) => item.id === preset)?.label;
    const nextDefaultTitle = TAROT_PRESETS.find((item) => item.id === value)?.label ?? '';
    setPreset(value);
    setPositions(makeTarotPositions(value, count));
    // Preserve a title the user wrote; follow the chosen template only while
    // they are still using the automatic template title.
    setTitle((current) => current === previousDefaultTitle ? nextDefaultTitle : current);
  };

  const chooseCount = (nextValue: number) => {
    const count = Math.min(12, Math.max(1, Math.trunc(nextValue || 1)));
    setCardCount(count);
    choosePreset(`template-${count}` as TarotPresetId, count);
  };

  const insert = () => {
    const success = insertTarotSpread(positions, preset, title);
    useEditorStore.getState().setToastMessage(
      success
        ? 'Tarot spread inserted. Select a card to edit its meaning in Properties.'
        : 'The canvas is not ready yet.'
    );
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="group w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-text)] bg-white/5 rounded-lg border border-[color:var(--border-subtle)] hover:bg-white/10"
      >
        <span className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[color:var(--brand-primary)]" />
          Tarot Spreads
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-[color:var(--border-subtle)] bg-white/5 p-3">
          <p className="text-[11px] text-[color:var(--ui-panel-text)]">
            Start with a layout, customize each position, then arrange the cards on the page.
          </p>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Number of cards</span>
            <select
              data-testid="tarot-card-count"
              aria-label="Number of tarot cards"
              value={cardCount}
              onChange={(event) => chooseCount(Number(event.target.value))}
              className="w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((count) => (
                <option key={count} value={count}>{count} {count === 1 ? 'card' : 'cards'}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Spread template</span>
            <select
              data-testid="tarot-spread-preset"
              className="w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
              value={preset}
              onChange={(event) => choosePreset(event.target.value as TarotPresetId)}
            >
              {getTarotPresetsForCount(cardCount).map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
          </label>
          <p className="text-[10px] text-[color:var(--ui-panel-text)]">
            {TAROT_PRESETS.find((option) => option.id === preset)?.description}
          </p>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Spread title</span>
            <input
              type="text"
              value={title}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Optional"
              className="w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
            />
          </label>
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">Layout preview</span>
            <div
              data-testid="tarot-spread-preview"
              role="img"
              aria-label={`${positions.length}-card spread preview`}
              className="relative mx-auto h-44 w-36 overflow-hidden rounded-lg border border-[color:var(--ui-border)] bg-[color:var(--ui-bg)]"
            >
              {positions.map((position) => (
                <span
                  key={position.number}
                  title={`${position.number}. ${position.label}`}
                  className="absolute flex items-center justify-center rounded-sm border border-[#B98F9D] bg-[#302935] text-[8px] font-semibold text-[#EADFCB]"
                  style={{
                    left: `${position.x * 100}%`,
                    top: `${position.y * 100}%`,
                    width: positions.length >= 9 ? 16 : 20,
                    height: positions.length >= 9 ? 24 : 31,
                    transform: `translate(-50%, -50%) rotate(${position.angle}deg)`,
                  }}
                >
                  {position.number}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
              Positions ({positions.length})
            </span>
            {positions.map((position) => (
              <details key={position.number} className="rounded-md border border-[color:var(--border-subtle)] px-2 py-1.5">
                <summary className="cursor-pointer text-[11px] text-[color:var(--ui-text)]">
                  {position.number}. {position.label || 'Untitled position'}
                </summary>
                <div className="space-y-2 pt-2">
                  <label className="block space-y-1">
                    <span className="text-[10px] text-[color:var(--ui-panel-text)]">Position label</span>
                    <input
                      aria-label={`Position ${position.number} label`}
                      value={position.label}
                      maxLength={80}
                      onChange={(event) => setPositions((current) =>
                        updateTarotPosition(current, position.number, 'label', event.target.value))}
                      className="w-full rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-[10px] text-[color:var(--ui-panel-text)]">Reflection question (saved with card)</span>
                    <textarea
                      aria-label={`Position ${position.number} question`}
                      value={position.prompt}
                      maxLength={500}
                      rows={2}
                      onChange={(event) => setPositions((current) =>
                        updateTarotPosition(current, position.number, 'prompt', event.target.value))}
                      className="w-full resize-y rounded-md border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-2 text-xs text-[color:var(--ui-text)]"
                    />
                  </label>
                </div>
              </details>
            ))}
          </div>
          <button
            data-testid="insert-tarot-spread"
            type="button"
            disabled={!canvasReady}
            onClick={insert}
            className="w-full rounded-lg bg-[color:var(--brand-primary)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            Insert editable spread
          </button>
          <p className="text-[10px] text-[color:var(--ui-panel-text)]">
            Each numbered card becomes its own movable layer. Shift-click multiple cards to align them or space them evenly from the floating toolbar.
          </p>
        </div>
      )}
    </div>
  );
};
