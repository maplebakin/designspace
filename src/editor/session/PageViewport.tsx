import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  createPageViewport,
  type PageViewport as PageViewportState,
  type ProjectSessionDescriptor,
} from './projectSession';

export type PageViewportChange = (viewport: PageViewportState) => void;

export type PageViewportProps = {
  session: ProjectSessionDescriptor | null;
  zoom: number;
  onViewportChange?: PageViewportChange;
  children: React.ReactNode;
};

/**
 * Phase 1 viewport boundary. It reports display geometry and the active page
 * without applying a second transform. Legacy renderers retain ownership of
 * their existing viewport implementation until the mixed-page compositor
 * phase.
 */
export const PageViewport: React.FC<PageViewportProps> = ({
  session,
  zoom,
  onViewportChange,
  children,
}) => {
  const boundaryRef = useRef<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({
    width: null as number | null,
    height: null as number | null,
  });

  const measureViewport = useCallback(() => {
    const boundary = boundaryRef.current;
    if (!boundary) return;
    const rect = boundary.getBoundingClientRect();
    setViewportSize({
      width: rect.width > 0 ? rect.width : null,
      height: rect.height > 0 ? rect.height : null,
    });
  }, []);

  useLayoutEffect(() => {
    measureViewport();
  }, [measureViewport]);

  useEffect(() => {
    const boundary = boundaryRef.current;
    if (!boundary) return;
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measureViewport);
      return () => window.removeEventListener('resize', measureViewport);
    }
    const observer = new ResizeObserver(measureViewport);
    observer.observe(boundary);
    return () => observer.disconnect();
  }, [measureViewport]);

  const viewport = useMemo(
    () => createPageViewport({
      session,
      zoom,
      viewportWidthCssPx: viewportSize.width,
      viewportHeightCssPx: viewportSize.height,
    }),
    [session, viewportSize.height, viewportSize.width, zoom]
  );

  const latestViewportRef = useRef(viewport);
  latestViewportRef.current = viewport;
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  useEffect(() => {
    onViewportChangeRef.current?.(viewport);
  }, [viewport]);

  useEffect(() => () => {
    onViewportChangeRef.current?.({
      ...latestViewportRef.current,
      mounted: false,
    });
  }, []);

  const activePage = session?.pages[session.activePageIndex];

  return (
    <div
      ref={boundaryRef}
      className="unified-page-viewport-boundary"
      data-testid="unified-page-viewport"
      data-renderer-kind={viewport.rendererKind}
      data-page-id={viewport.pageId || undefined}
      data-page-coordinate-space={activePage?.size.coordinateSpace}
      data-page-width-css-px={activePage?.size.widthCssPx}
      data-page-height-css-px={activePage?.size.heightCssPx}
      data-editor-chrome-boundary={viewport.editorChromeBoundary}
      data-viewport-zoom={viewport.zoom}
      data-viewport-mounted={viewport.mounted ? 'true' : 'false'}
    >
      {children}
    </div>
  );
};
