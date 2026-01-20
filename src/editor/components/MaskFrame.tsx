import React from 'react';
import { shallow } from 'zustand/shallow';
import { Badge, Circle, Hexagon, Star } from 'lucide-react';
import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';
import * as frameFactories from '../fabric/frameFactories';

const ICON_CLASS = 'w-4 h-4 stroke-[1.5] text-[color:var(--muted-icon)]';

type FrameAction = {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
};

export const MaskFrame: React.FC = () => {
    const { canvas } = useEditorStore(
        (state) => ({
            canvas: state.canvas,
        }),
        shallow
    );

    const handleAddFrame = (factory: (target: fabric.Canvas) => void) => {
        if (!canvas) return;
        factory(canvas);
    };

    const actions: FrameAction[] = [
        { label: 'Circle', icon: <Circle className={ICON_CLASS} />, onClick: () => handleAddFrame(frameFactories.addCircleFrame) },
        { label: 'Star', icon: <Star className={ICON_CLASS} />, onClick: () => handleAddFrame(frameFactories.addStarFrame) },
        { label: 'Hexagon', icon: <Hexagon className={ICON_CLASS} />, onClick: () => handleAddFrame(frameFactories.addHexagonFrame) },
        { label: 'Badge', icon: <Badge className={ICON_CLASS} />, onClick: () => handleAddFrame(frameFactories.addBadgeFrame) },
    ];

    return (
        <section className="rounded-lg border border-[color:var(--border-subtle)] bg-white/5 p-3">
            <h3 className="text-[10px] uppercase tracking-widest text-slate-200 mb-2">Mask Frames</h3>
            <div className="grid grid-cols-2 gap-2">
                {actions.map((action) => (
                    <button
                        key={action.label}
                        onClick={action.onClick}
                        className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-all"
                    >
                        {action.icon}
                        <span>{action.label}</span>
                    </button>
                ))}
            </div>
        </section>
    );
};
