import React from 'react';
import { useEditorStore } from '../state/editorStore';
import { PRINT_DPI, formatInches } from '../utils/units';

interface RulerProps {
  orientation: 'horizontal' | 'vertical';
}

const RULER_SIZE = 24;
const TICK_COLOR = 'rgba(226, 232, 240, 0.7)';

export const Ruler: React.FC<RulerProps> = ({ orientation }) => {
  const { zoom, vpt, unitMode, isPreviewMode } = useEditorStore();
  const ref = React.useRef<SVGSVGElement>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  React.useEffect(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    }
  }, []);

  if (isPreviewMode) {
    return null;
  }

  const isHorizontal = orientation === 'horizontal';
  const transform = `translate(${isHorizontal ? vpt[4] : 0}, ${isHorizontal ? 0 : vpt[5]}) scale(${zoom})`;

  const baseSpacing = unitMode === 'in' ? PRINT_DPI : 100;
  let majorTickSpacing = baseSpacing;
  if (zoom > 2) majorTickSpacing = unitMode === 'in' ? PRINT_DPI / 2 : 50;
  if (zoom > 4) majorTickSpacing = unitMode === 'in' ? PRINT_DPI / 5 : 20;
  if (zoom < 0.5) majorTickSpacing = unitMode === 'in' ? PRINT_DPI * 2 : 200;

  const minorTickSpacing = majorTickSpacing / 5;

  const ticks = [];
  const maxDim = isHorizontal ? size.width / zoom + Math.abs(vpt[4] / zoom) : size.height / zoom + Math.abs(vpt[5] / zoom);

  for (let i = 0; i < maxDim; i += minorTickSpacing) {
    const isMajor = i % majorTickSpacing === 0;
    if (i === 0) continue;

    if (isHorizontal) {
      ticks.push(
        <g key={i}>
          <line x1={i} y1={isMajor ? RULER_SIZE - 10 : RULER_SIZE - 5} x2={i} y2={RULER_SIZE} stroke={TICK_COLOR} strokeWidth={0.5} />
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
          <line x1={isMajor ? RULER_SIZE - 10 : RULER_SIZE - 5} y1={i} x2={RULER_SIZE} y2={i} stroke={TICK_COLOR} strokeWidth={0.5} />
          {isMajor && (
            <text x={RULER_SIZE - 12} y={i + 10} fontSize={10} writingMode="vertical-rl" fill={TICK_COLOR}>
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
      className={`absolute ${isHorizontal ? 'top-0 left-0 w-full' : 'top-0 left-0 h-full'} bg-white/10 backdrop-blur-sm z-20`}
      style={{
        width: isHorizontal ? '100%' : RULER_SIZE,
        height: isHorizontal ? RULER_SIZE : '100%',
      }}
    >
      <g transform={transform}>{ticks}</g>
      <rect width={RULER_SIZE} height={RULER_SIZE} fill="rgba(255,255,255,0.08)" />
    </svg>
  );
};
