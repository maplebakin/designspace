import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Native modal keeps keyboard focus and pointer input out of the live editor. */
export const ThemePreviewDialog = ({
  children,
  onCancel,
}: {
  children: ReactNode;
  onCancel: () => void;
}) => {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="theme-bridge-dialog"
      aria-label="Theme preview"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      style={{
        boxSizing: 'border-box',
        width: 'calc(100vw - 48px)',
        maxWidth: 1200,
        maxHeight: 'calc(100vh - 48px)',
        background: 'var(--ui-panel-opaque, #202126)',
        color: 'var(--ui-text, white)',
        overflow: 'auto',
        padding: 24,
        border: '1px solid var(--ui-border, #666)',
        borderRadius: 12,
      }}
    >
      {children}
    </dialog>,
    document.body
  );
};
