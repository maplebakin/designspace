import * as fabric from 'fabric';
import { createContext, useContext } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';

export type PluginHookName = 'onObjectAdded' | 'onExport' | 'onThemeChange';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
}

export interface PluginAPI {
  getCanvas: () => fabric.Canvas | null;
  addSerializedObject: (object: any) => void;
  removeObject: (objectId: string) => void;
  getObjects: () => any[];
  getState: () => ReturnType<typeof useEditorStore.getState>;
  getThemeStoreState: typeof useThemeStore.getState;
  showToast: (message: string) => void;
}

export interface Plugin {
  metadata: PluginMetadata;
  init: (api: PluginAPI) => void | Promise<void>;
  destroy?: () => void | Promise<void>;
  hooks?: Partial<Record<PluginHookName, (payload: any) => void | Promise<void>>>;
}

export class PluginManager {
  private plugins = new Map<string, Plugin>();

  private api: PluginAPI = {
    getCanvas: () => useEditorStore.getState().canvas,
    addSerializedObject: (object) => {
      useEditorStore.getState().addObject(object, { save: true, select: true });
    },
    removeObject: (objectId) => {
      useEditorStore.getState().removeObject(objectId, { save: true });
    },
    getObjects: () => useEditorStore.getState().canvasObjects,
    getState: () => useEditorStore.getState(),
    getThemeStoreState: () => useThemeStore.getState(),
    showToast: (message) => useEditorStore.getState().setToast(message),
  };

  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.metadata.id)) {
      return;
    }
    this.plugins.set(plugin.metadata.id, plugin);
    await plugin.init(this.api);
  }

  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      return;
    }
    await plugin.destroy?.();
    this.plugins.delete(pluginId);
  }

  getThemeStoreState() {
    return useThemeStore.getState();
  }

  async emitHook(hook: PluginHookName, payload: any): Promise<void> {
    for (const plugin of this.plugins.values()) {
      const handler = plugin.hooks?.[hook];
      if (handler) {
        await handler(payload);
      }
    }
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }
}

export const pluginManager = new PluginManager();

export const PluginManagerContext = createContext(pluginManager);

export const usePluginManager = () => useContext(PluginManagerContext);
