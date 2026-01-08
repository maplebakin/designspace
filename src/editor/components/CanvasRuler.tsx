import React from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { PRINT_DPI, formatInches } from '../utils/units';

type RulerOrientation = 'horizontal' | 'vertical';

interface RulerAxisProps {
  orientation: RulerOrientation;
}

const RULER_SIZE = 24;
const TICK_COLOR = 'var(--ui-ruler-tick)';
const FACE_COLOR = 'var(--ui-ruler-face)';

const RulerAxis: React.FC<RulerAxisProps> = ({ orientation }) => {
  const { zoom, vpt, unitMode, canvasOffset, canvas } = useEditorStore(
    (state) => ({
      zoom: state.zoom,
      vpt: state.vpt,
      unitMode: state.unitMode,
      canvasOffset: state.canvasOffset,
      canvas: state.canvas,
    }),
    shallow
  );
  const ref = React.useRef<SVGSVGElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
  }, []);

  const isHorizontal = orientation === 'horizontal';
  const offsetX = canvasOffset?.x ?? 0;
  const offsetY = canvasOffset?.y ?? 0;
  const transform = `translate(${isHorizontal ? vpt[4] : 0}, ${isHorizontal ? 0 : vpt[5]}) scale(${zoom})`;

  const baseSpacing = unitMode === 'in' ? PRINT_DPI : 100;
  let majorTickSpacing = baseSpacing;
  if (zoom > 2) majorTickSpacing = unitMode === 'in' ? PRINT_DPI / 2 : 50;
  if (zoom > 4) majorTickSpacing = unitMode === 'in' ? PRINT_DPI / 5 : 20;
  if (zoom < 0.5) majorTickSpacing = unitMode === 'in' ? PRINT_DPI * 2 : 200;

  const minorTickSpacing = majorTickSpacing / 5;

  const ticks = [];
  const canvasWidth = canvas?.getWidth() ?? size.width;
  const canvasHeight = canvas?.getHeight() ?? size.height;
  const maxDim = isHorizontal
    ? canvasWidth / zoom + Math.abs(vpt[4] / zoom)
    : canvasHeight / zoom + Math.abs(vpt[5] / zoom);

  for (let i = 0; i < maxDim; i += minorTickSpacing) {
    const isMajor = i % majorTickSpacing === 0;
    if (i === 0) continue;

    if (isHorizontal) {
      ticks.push(
        <g key={i}>
          <line
            x1={i}
            y1={isMajor ? RULER_SIZE - 10 : RULER_SIZE - 5}
            x2={i}
            y2={RULER_SIZE}
            stroke={TICK_COLOR}
            strokeWidth={0.5}
          />
          {isMajor && (
            <text x={i + 2} y={RULER_SIZE - 12} fontSize={10} fill={TICK_COLOR}>
              {unitMode === 'in' ? formatInches(i / PRINT_DPI) : i}
            </text>
          )}
        </g>
      );
    } else {
      ticks.push(
        <g key={i}>
          <line
            x1={isMajor ? RULER_SIZE - 10 : RULER_SIZE - 5}
            y1={i}
            x2={RULER_SIZE}
            y2={i}
            stroke={TICK_COLOR}
            strokeWidth={0.5}
          />
          {isMajor && (
            <text
              x={RULER_SIZE - 12}
              y={i + 10}
              fontSize={10}
              writingMode="vertical-rl"
              fill={TICK_COLOR}
            >
              {unitMode === 'in' ? formatInches(i / PRINT_DPI) : i}
            </text>
          )}
        </g>
      );
    }
  }

  return (
    <svg
      ref={ref}
      className={`absolute ${isHorizontal ? 'top-0 left-0' : 'top-0 left-0'} z-20`}
      style={{
        width: isHorizontal ? (canvas?.getWidth() ?? '100%') : RULER_SIZE,
        height: isHorizontal ? RULER_SIZE : (canvas?.getHeight() ?? '100%'),
        backgroundColor: FACE_COLOR,
        left: isHorizontal ? offsetX : Math.max(0, offsetX - RULER_SIZE),
        top: isHorizontal ? Math.max(0, offsetY - RULER_SIZE) : offsetY,
      }}
    >
      <g transform={transform}>{ticks}</g>
      <rect width={RULER_SIZE} height={RULER_SIZE} fill={FACE_COLOR} />
    </svg>
  );
};

export const CanvasRuler: React.FC = () => (
  <>
    <RulerAxis orientation="horizontal" />
    <RulerAxis orientation="vertical" />
  </>
);
