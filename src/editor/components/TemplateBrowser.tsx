
import React from 'react';
import { useEditorStore, Template } from '../state/editorStore';

export const TemplateBrowser: React.FC = () => {
    const { templates, userTemplates, loadTemplate, setToastMessage, saveCurrentAsTemplate } = useEditorStore();

    // Placeholder templates (Witchy vibe)
    const predefinedTemplates: Template[] = [
        {
            id: 'daily-ritual',
            name: 'Daily Ritual',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Heading
                    {
                        type: 'i-text',
                        left: 100, top: 50,
                        text: 'Daily Ritual',
                        fontSize: 40,
                        fontFamily: 'serif',
                        fill: '#333',
                        id: 'text-heading',
                        tokenRole: 'typography.heading.value'
                    },
                    // Body text
                    {
                        type: 'i-text',
                        left: 100, top: 120,
                        text: 'Intentions & Affirmations:',
                        fontSize: 20,
                        fontFamily: 'sans-serif',
                        fill: '#666',
                        id: 'text-body-1',
                        tokenRole: 'typography.body.value'
                    },
                    // Sigil slots (placeholders)
                    {
                        type: 'rect',
                        left: 100, top: 200,
                        width: 150, height: 150,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 12,
                        ry: 12,
                        id: 'sigil-slot-1',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    },
                    {
                        type: 'rect',
                        left: 300, top: 200,
                        width: 150, height: 150,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 12,
                        ry: 12,
                        id: 'sigil-slot-2',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    }
                ]
            }),
            defaultThemeId: 'witchy-theme-id-1', // Placeholder ID
        },
        {
            id: 'herb-profile',
            name: 'Herb Profile',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Image slot
                    {
                        type: 'rect',
                        left: 100, top: 50,
                        width: 200, height: 200,
                        fill: '#e2e8f0',
                        stroke: '#cbd5e1',
                        strokeWidth: 1,
                        rx: 16,
                        ry: 16,
                        id: 'herb-image-slot',
                        tokenRole: 'surfaces.surface-plain',
                        isPlaceholder: true
                    },
                    // Muted text slots
                    {
                        type: 'i-text',
                        left: 350, top: 50,
                        text: 'Name: Belladonna',
                        fontSize: 24,
                        fontFamily: 'sans-serif',
                        fill: '#888',
                        id: 'herb-name',
                        tokenRole: 'typography.body.value'
                    },
                    {
                        type: 'i-text',
                        left: 350, top: 90,
                        text: 'Uses: Divination, Protection',
                        fontSize: 18,
                        fontFamily: 'sans-serif',
                        fill: '#AAA',
                        id: 'herb-uses',
                        tokenRole: 'typography.body.value'
                    },
                    // Border accent (simple rectangle for now)
                    {
                        type: 'rect',
                        left: 50, top: 30,
                        width: 500, height: 300,
                        fill: 'transparent',
                        stroke: '#B45F06',
                        strokeWidth: 5,
                        id: 'border-accent',
                        tokenRole: 'brand.accent.value'
                    }
                ]
            }),
            defaultThemeId: 'witchy-theme-id-2', // Placeholder ID
        },
        {
            id: 'moon-phase-tracker',
            name: 'Moon Phase Tracker',
            canvasData: JSON.stringify({
                version: '5.0.0',
                objects: [
                    // Title
                    {
                        type: 'i-text',
                        left: 50, top: 30,
                        text: 'Moon Phase Tracker',
                        fontSize: 36,
                        fontFamily: 'serif',
                        fill: '#333',
                        id: 'moon-title',
                        tokenRole: 'typography.heading.value'
                    },
                    // Celestial grid slots (circles for moon phases)
                    {
                        type: 'circle',
                        left: 100, top: 120,
                        radius: 30,
                        fill: '#F0F0F0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-1',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'circle',
                        left: 200, top: 120,
                        radius: 30,
                        fill: '#E0E0E0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-2',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'circle',
                        left: 300, top: 120,
                        radius: 30,
                        fill: '#D0D0D0',
                        stroke: '#888',
                        strokeWidth: 1,
                        id: 'moon-phase-3',
                        tokenRole: 'brand.secondary.value'
                    },
                    {
                        type: 'i-text',
                        left: 100, top: 200,
                        text: 'New Moon',
                        fontSize: 14,
                        fontFamily: 'sans-serif',
                        fill: '#666',
                        id: 'moon-label-1',
                        tokenRole: 'typography.body.value'
                    }
                    // ... more moon phases can be added
                ]
            }),
            defaultThemeId: 'witchy-theme-id-3', // Placeholder ID
        },
    ];

    React.useEffect(() => {
        // In a real app, you might fetch templates from a backend
        // For now, we'll use predefined ones
        useEditorStore.getState().setTemplates(predefinedTemplates);
    }, []);

    const handleLoadTemplate = (template: Template) => {
        const confirmLoad = window.confirm(
            'Loading a new template will clear your current canvas. Are you sure?'
        );
        if (confirmLoad) {
            loadTemplate(template);
        } else {
            setToastMessage('Template loading cancelled.');
        }
    };

    return (
        <div className="py-4 space-y-6">
            <div className="px-4">
                <button
                    onClick={() => saveCurrentAsTemplate()}
                    className="w-full mb-4 text-left px-4 py-3 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest text-slate-200"
                >
                    Save as Template
                </button>
            </div>
            {userTemplates.length > 0 && (
                <div className="px-4">
                    <h3 className="text-[11px] uppercase tracking-widest text-slate-400 mb-3">Your Templates</h3>
                    <div className="grid grid-cols-2 gap-2">
                        {userTemplates.map((template) => (
                            <button
                                key={template.id}
                                onClick={() => handleLoadTemplate(template)}
                                className="w-full text-left p-3 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
                            >
                                <img
                                    src={template.thumbnail || `https://via.placeholder.com/150x100/333333/FFFFFF?text=${encodeURIComponent(template.name)}`}
                                    alt={template.name}
                                    className="w-full h-20 object-cover rounded-md mb-2"
                                />
                                <span className="text-xs uppercase tracking-widest text-slate-300">{template.name}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className="px-4">
                <h3 className="text-[11px] uppercase tracking-widest text-slate-400 mb-3">Community Templates</h3>
                <div className="grid grid-cols-2 gap-2">
                    {templates.map((template) => (
                        <button 
                            key={template.id}
                            onClick={() => handleLoadTemplate(template)}
                            className="w-full text-left p-3 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
                        >
                            <img 
                                src={`https://via.placeholder.com/150x100/333333/FFFFFF?text=${encodeURIComponent(template.name)}`}
                                alt={template.name}
                                className="w-full h-20 object-cover rounded-md mb-2"
                            />
                            <span className="text-xs uppercase tracking-widest text-slate-300">{template.name}</span>
                            {/* Optionally show theme info or description */}
                            {/* <p className="text-[10px] uppercase tracking-widest text-slate-500">{template.defaultThemeId}</p> */}
                        </button>
                    ))}
                </div>
            </div>
            {/* Additional sections for saved templates, etc. */}
        </div>
    );
};
