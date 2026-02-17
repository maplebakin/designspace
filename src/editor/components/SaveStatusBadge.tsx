import React from 'react';
import type { SaveStatus } from '../state/editorStore';

type SaveStatusBadgeProps = {
  status: SaveStatus;
  compact?: boolean;
};

const STATUS_META: Record<SaveStatus, { label: string; className: string; pulse?: boolean }> = {
  saved: {
    label: 'Saved',
    className: 'text-emerald-300 border-emerald-400/30 bg-emerald-500/10',
  },
  saving: {
    label: 'Saving...',
    className: 'text-sky-300 border-sky-400/30 bg-sky-500/10',
    pulse: true,
  },
  unsaved: {
    label: 'Unsaved changes',
    className: 'text-amber-200 border-amber-300/30 bg-amber-500/10',
  },
  error: {
    label: 'Save failed',
    className: 'text-rose-200 border-rose-400/40 bg-rose-500/10',
  },
};

export const SaveStatusBadge: React.FC<SaveStatusBadgeProps> = ({ status, compact = false }) => {
  const meta = STATUS_META[status];
  return (
    <div
      className={`inline-flex items-center rounded-full border px-3 py-1 uppercase tracking-widest ${compact ? 'text-[9px]' : 'text-[10px]'} ${meta.className}`}
      role="status"
      aria-live="polite"
    >
      <span className={meta.pulse ? 'animate-pulse' : ''}>{meta.label}</span>
    </div>
  );
};
