import React, { useState } from 'react';
import * as fabric from 'fabric';
import { v4 as uuidv4 } from 'uuid';
import { shallow } from 'zustand/shallow';
import {
  Heart,
  Star,
  MessageCircle,
  Share2,
  Search,
  FileText,
  User,
  Square,
  Circle,
  Triangle,
} from 'lucide-react';
import { useEditorStore } from '../state/editorStore';

// Define asset types
interface Asset {
  id: string;
  name: string;
  type: 'shape' | 'icon' | 'ui-kit' | 'component';
  icon: React.ComponentType<any>;
  data: any; // Fabric.js object data
}

// Predefined assets library
const predefinedAssets: Asset[] = [
  // Shapes
  {
    id: 'shape-card',
    name: 'Rounded Card',
    type: 'shape',
    icon: Square,
    data: {
      type: 'rect',
      width: 200,
      height: 120,
      rx: 12,
      ry: 12,
      fill: '#ffffff',
      stroke: '#e2e8f0',
      strokeWidth: 1,
      id: uuidv4(),
    }
  },
  {
    id: 'shape-circle',
    name: 'Circle',
    type: 'shape',
    icon: Circle,
    data: {
      type: 'circle',
      radius: 50,
      fill: '#3b82f6',
      stroke: '#1d4ed8',
      strokeWidth: 2,
      id: uuidv4(),
    }
  },
  {
    id: 'shape-triangle',
    name: 'Triangle',
    type: 'shape',
    icon: Triangle,
    data: {
      type: 'triangle',
      width: 100,
      height: 100,
      fill: '#ef4444',
      stroke: '#dc2626',
      strokeWidth: 2,
      id: uuidv4(),
    }
  },
  {
    id: 'shape-button',
    name: 'CTA Button',
    type: 'ui-kit',
    icon: Square,
    data: {
      type: 'rect',
      width: 150,
      height: 48,
      rx: 8,
      ry: 8,
      fill: '#3b82f6',
      stroke: '#2563eb',
      strokeWidth: 0,
      id: uuidv4(),
    }
  },
  
  // Icons
  {
    id: 'icon-heart',
    name: 'Heart',
    type: 'icon',
    icon: Heart,
    data: {
      type: 'i-text',
      text: '♥',
      fontSize: 32,
      fontFamily: 'Arial',
      fill: '#ef4444',
      id: uuidv4(),
    }
  },
  {
    id: 'icon-star',
    name: 'Star',
    type: 'icon',
    icon: Star,
    data: {
      type: 'i-text',
      text: '★',
      fontSize: 32,
      fontFamily: 'Arial',
      fill: '#fbbf24',
      id: uuidv4(),
    }
  },
  {
    id: 'icon-message',
    name: 'Message',
    type: 'icon',
    icon: MessageCircle,
    data: {
      type: 'i-text',
      text: '✉',
      fontSize: 32,
      fontFamily: 'Arial',
      fill: '#60a5fa',
      id: uuidv4(),
    }
  },
  {
    id: 'icon-share',
    name: 'Share',
    type: 'icon',
    icon: Share2,
    data: {
      type: 'i-text',
      text: ' SHARE',
      fontSize: 16,
      fontFamily: 'Arial',
      fill: '#6b7280',
      id: uuidv4(),
    }
  },
  
  // UI Components
  {
    id: 'ui-input',
    name: 'Input Field',
    type: 'ui-kit',
    icon: FileText,
    data: {
      type: 'rect',
      width: 250,
      height: 40,
      rx: 6,
      ry: 6,
      fill: '#ffffff',
      stroke: '#cbd5e1',
      strokeWidth: 1,
      id: uuidv4(),
    }
  },
  {
    id: 'ui-avatar',
    name: 'Avatar',
    type: 'ui-kit',
    icon: User,
    data: {
      type: 'circle',
      radius: 30,
      fill: '#9ca3af',
      stroke: '#6b7280',
      strokeWidth: 2,
      id: uuidv4(),
    }
  }
];

const AssetLibrary: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  const { canvas, requestLayerSync, saveState, syncCanvasToStore } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      requestLayerSync: state.requestLayerSync,
      saveState: state.saveState,
      syncCanvasToStore: state.syncCanvasToStore,
    }),
    shallow
  );

  // Filter assets based on search and category
  const filteredAssets = predefinedAssets.filter(asset => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || asset.type === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Inject asset into canvas at viewport center
  const injectAsset = (assetData: any) => {
    if (!canvas) return;

    // Get viewport center
    const vpt = canvas.viewportTransform;
    if (!vpt) return;

    const centerX = (canvas.getWidth() / 2 - vpt[4]) / vpt[0];
    const centerY = (canvas.getHeight() / 2 - vpt[5]) / vpt[3];

    // Create object from asset data using the same approach as the clipboard service
    const createObjectFromData = async (data: any) => {
      const type = data.type;
      switch (type) {
        case 'rect':
          return new fabric.Rect({
            ...data,
            left: centerX,
            top: centerY,
            originX: 'center',
            originY: 'center',
          });
        case 'circle':
          return new fabric.Circle({
            ...data,
            left: centerX,
            top: centerY,
            originX: 'center',
            originY: 'center',
          });
        case 'triangle':
          return new fabric.Triangle({
            ...data,
            left: centerX,
            top: centerY,
            originX: 'center',
            originY: 'center',
          });
        case 'i-text':
          return new fabric.IText(data.text || '', {
            ...data,
            left: centerX,
            top: centerY,
            originX: 'center',
            originY: 'center',
          });
        default:
          console.warn(`Unsupported asset type: ${type}`);
          return null;
      }
    };

    // Create and add the object
    createObjectFromData(assetData).then(obj => {
        if (obj) {
          canvas.add(obj);
          useEditorStore.getState().selectObjectById((obj as any).id);
          syncCanvasToStore(canvas);
          canvas.requestRenderAll();
          requestLayerSync();
          saveState();
          document.getElementById('editor-shell')?.focus();
        }
      });
  };

  // Categories for filtering
  const categories = [
    { id: 'all', name: 'All Assets' },
    { id: 'shape', name: 'Shapes' },
    { id: 'icon', name: 'Icons' },
    { id: 'ui-kit', name: 'UI Kits' },
  ];

  return (
    <div className="h-full flex flex-col bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)] backdrop-blur-[var(--ui-blur)] border border-[color:var(--ui-border)] rounded-xl transition-all duration-300 ease-in-out p-4">
      <div className="mb-4">
        <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3">Asset Library</h3>
        
        {/* Search and filter */}
        <div className="relative mb-3">
          <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[color:var(--ui-panel-text)]" />
          <input
            type="text"
            placeholder="Search assets..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/30 px-8 py-1.5 text-xs text-[color:var(--ui-text)] placeholder:text-[color:var(--ui-panel-text)]/60 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
          />
        </div>
        
        {/* Category filter */}
        <div className="flex flex-wrap gap-1">
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => setSelectedCategory(category.id)}
              className={`px-2 py-1 text-xs rounded-lg transition-colors ${
                selectedCategory === category.id
                  ? 'bg-[color:var(--brand-primary)] text-white'
                  : 'bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>
      
      {/* Assets grid */}
      <div className="flex-1 overflow-y-auto">
        {filteredAssets.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[color:var(--ui-panel-text)]/60 text-sm">
            No assets found
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredAssets.map(asset => {
              const IconComponent = asset.icon;
              return (
                <button
                  key={asset.id}
                  data-testid={`asset-library-item-${asset.id}`}
                  onClick={() => injectAsset(asset.data)}
                  className="flex flex-col items-center justify-center p-3 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors group"
                  title={asset.name}
                >
                  <div className="w-8 h-8 flex items-center justify-center text-[color:var(--brand-primary)] mb-2">
                    <IconComponent className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-[color:var(--ui-panel-text)] group-hover:text-white truncate w-full text-center">
                    {asset.name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export { AssetLibrary };
