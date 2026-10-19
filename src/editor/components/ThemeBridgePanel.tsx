import './theme-bridge.css';
import * as fabric from 'fabric';
import { serializeCanvasObjects } from '../utils/serialization';
import {
  reviveCustomFabricProps,
  loadCanvasFromJsonSafely,
} from '../fabric/initFabricCanvas';
import { ThemePreviewDialog } from './ThemePreviewDialog';
import { useEffect, useState } from 'react';
import type { DesignSpaceTheme } from '../../utils/designSpaceTheme';
import { DESIGN_SPACE_COLOR_ROLES } from '../../utils/designSpaceTheme';
import { ingestApocapalette } from '../../utils/paletteIngest';
import { useThemeStore } from '../state/useThemeStore';
import { useEditorStore } from '../state/editorStore';
import { useDocumentStore } from '../../document/state/documentStore';
import { projectDocumentTheme } from '../../document/services/documentThemeBridge';
import { ExportPageSurface } from '../../document/components/DocumentProjectExportRenderer';
import { flushDocumentLiveDrafts } from '../../document/services/documentLiveDraft';
import type { DocumentProjectPayload } from '../project/projectSchema';
import { bridgeThemeTokens, visitBridgeObjects } from '../services/themeBridge';
import { useCanvasStore } from '../state/useCanvasStore';
import { isPersistableCanvasObject } from '../utils/objectUtils';

const rootReady = () => undefined;
type ThemePreview = {
  theme: DesignSpaceTheme;
  project?: DocumentProjectPayload;
  baseline?: DocumentProjectPayload;
  canvas?: fabric.Canvas;
  canvasRevision?: number;
  pageIndex?: number;
  image?: string;
  report: string;
};

export const ThemeBridgePanel = ({
  documentMode = false,
}: {
  documentMode?: boolean;
}) => {
  const imported = useThemeStore((state) => state.importedPalette);
  const project = useDocumentStore((state) => state.project);
  const activeTheme = useThemeStore((state) => state.themeData);
  const theme = imported?.bridgeTheme;
  const selected = documentMode
    ? project?.document.bridgeTheme?.name
    : activeTheme?.meta?.name;
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<ThemePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const documentSession = useDocumentStore((state) => state.sessionIdentity);
  const canvasSession = useEditorStore((state) => state.sessionIdentity);
  useEffect(() => {
    setPreview(null);
  }, [documentSession, canvasSession]);

  const importFile = async (file?: File) => {
    if (!file) return;
    setError('');
    setPreview(null);
    try {
      const palette = ingestApocapalette(JSON.parse(await file.text()));
      useThemeStore.getState().setImportedPalette(palette);
      setLegacy(!palette.bridgeTheme);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not import palette JSON.'
      );
    }
  };

  const startPreview = async () => {
    if (!theme) return;
    setError('');
    setLoading(true);
    try {
      if (documentMode) {
        flushDocumentLiveDrafts();
        const baseline = useDocumentStore.getState().project;
        if (!baseline) return;
        const result = projectDocumentTheme(baseline, theme);
        setPreview({
          theme,
          baseline,
          project: result.project,
          report: `All pages: paper, headings, body and secondary named styles. Custom style colours preserved: ${result.preservedStyles.join(', ') || 'none'}. Inline colours, custom drop caps, writing rules, photos and geometry are unchanged. Surface, accent, CTA and border roles are retained but have no automatic Document targets.`,
        });
      } else {
        const { canvas, changeRevision, activePageIndex } =
          useEditorStore.getState();
        if (!canvas) throw new Error('Open a canvas project first.');
        const tokens = bridgeThemeTokens(theme);
        const objects = canvas.getObjects().filter(isPersistableCanvasObject);
        const report = visitBridgeObjects(objects, tokens);
        const { width, height } = useCanvasStore.getState();
        const canvasSize = { width, height };
        const clone = new fabric.StaticCanvas(undefined, {
          ...canvasSize,
          enableRetinaScaling: false,
        });
        try {
          await loadCanvasFromJsonSafely(
            clone as fabric.Canvas,
            { objects: serializeCanvasObjects(canvas) },
            reviveCustomFabricProps
          );
          visitBridgeObjects(clone.getObjects(), tokens, true);
          clone.backgroundColor = theme.colors.background;
          clone.setViewportTransform([1, 0, 0, 1, 0, 0]);
          clone.setDimensions(canvasSize);
          clone.renderAll();
          setPreview({
            theme,
            canvas,
            canvasRevision: changeRevision,
            pageIndex: activePageIndex,
            image: clone.toDataURL({
              multiplier: Math.min(1, 1000 / canvasSize.width),
            }),
            report: `Active page only: ${report.linked} linked, ${report.unthemed} unthemed, ${report.locked} locked, ${report.images} images. Unthemed objects, locks and images remain unchanged. Other pages are unchanged. Unthemed: ${report.unthemedObjects.slice(0, 12).join(', ') || 'none'}${report.unthemedObjects.length > 12 ? '; more unthemed objects on this page' : ''}.`,
          });
        } finally {
          await clone.dispose();
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Preview failed.');
    } finally {
      setLoading(false);
    }
  };

  const apply = () => {
    if (!preview) return;
    if (documentMode) {
      flushDocumentLiveDrafts();
      if (useDocumentStore.getState().project !== preview.baseline) {
        setError(
          'The document changed. Cancel and preview again before applying.'
        );
        return;
      }
      useDocumentStore.getState().applyBridgeTheme(preview.theme);
    } else {
      const current = useEditorStore.getState();
      if (
        current.canvas !== preview.canvas ||
        current.changeRevision !== preview.canvasRevision ||
        current.activePageIndex !== preview.pageIndex
      ) {
        setError(
          'The canvas changed. Cancel and preview again before applying.'
        );
        return;
      }
      current.applyBridgeTheme(preview.theme);
    }
    setPreview(null);
  };

  return (
    <section
      aria-label="Apocapalette theme"
      className="theme-bridge-panel space-y-2"
    >
      {documentMode && (
        <label className="document-field">
          <span>Import Apocapalette</span>
          <input
            aria-label="Import Apocapalette JSON"
            type="file"
            accept=".json,application/json"
            onChange={(event) => {
              void importFile(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      )}
      {selected && (
        <p data-testid="selected-bridge-theme">Selected theme: {selected}</p>
      )}
      {error && <p role="alert">{error}</p>}
      {documentMode && legacy && (
        <p>
          Legacy palette imported as swatches. Semantic preview requires a
          version 1 theme export.
        </p>
      )}
      {documentMode && legacy && imported && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(imported.categories).flatMap(([category, values]) =>
            Object.entries(values || {}).map(([role, color]) => (
              <span
                key={`${category}-${role}`}
                title={`${role}: ${color}`}
                style={{ backgroundColor: color, width: 20, height: 20 }}
              />
            ))
          )}
        </div>
      )}
      {theme && (
        <div>
          <p>
            <strong>{theme.name}</strong> · {theme.mode}
          </p>
          <div
            className="flex flex-wrap gap-1"
            aria-label="Exact theme colours"
          >
            {DESIGN_SPACE_COLOR_ROLES.map((role) => (
              <span
                key={role}
                title={`${role}: ${theme.colors[role]}`}
                aria-label={`${role}: ${theme.colors[role]}`}
                style={{
                  backgroundColor: theme.colors[role],
                  display: 'inline-block',
                  width: 22,
                  height: 22,
                  border: '1px solid #888',
                }}
              />
            ))}
          </div>
          <button
            className="theme-bridge-action"
            type="button"
            disabled={loading}
            onClick={() => void startPreview()}
          >
            {loading ? 'Preparing preview…' : 'Preview theme'}
          </button>
          <p className="text-xs">
            Colours are used exactly as exported. Contrast is not repaired.
          </p>
        </div>
      )}
      {preview && (
        <ThemePreviewDialog
          onCancel={() => {
            setPreview(null);
            setError('');
          }}
        >
          <h2>
            {preview.theme.name} · {preview.theme.mode}
          </h2>
          <p>{preview.report}</p>
          <p>Preview only. Apply creates an undoable theme change.</p>
          <button className="theme-bridge-action" type="button" onClick={apply}>
            Apply theme
          </button>{' '}
          <button
            className="theme-bridge-action"
            type="button"
            onClick={() => {
              setPreview(null);
              setError('');
            }}
          >
            Cancel preview
          </button>
          {error && <p role="alert">{error}</p>}
          <div style={{ pointerEvents: 'none', marginTop: 16 }}>
            {preview.project && (
              <ExportPageSurface
                page={
                  preview.project.pages[preview.project.activePageIndex ?? 0]
                }
                pageIndex={preview.project.activePageIndex ?? 0}
                project={preview.project}
                onRootReady={rootReady}
              />
            )}
            {preview.image && (
              <img
                alt="Current canvas with the imported theme"
                src={preview.image}
                style={{ maxWidth: '100%' }}
              />
            )}
          </div>
        </ThemePreviewDialog>
      )}
    </section>
  );
};
