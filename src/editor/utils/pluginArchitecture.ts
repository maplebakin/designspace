/**
 * pluginArchitecture - Plugin architecture with API exposure
 * Implements Task 19: Create plugin architecture with API exposure
 */

import * as fabric from 'fabric';
import { useEditorStore } from '../state/editorStore';

// Define plugin interfaces
export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  license: string;
}

export interface PluginAPI {
  // Canvas manipulation
  getCanvas: () => fabric.Canvas | null;
  addShape: (shape: fabric.Object) => void;
  removeObject: (objectId: string) => void;
  getObjects: () => fabric.Object[];
  
  // State management
  getState: () => any;
  setState: (state: any) => void;
  
  // Theme management
  getTheme: () => any;
  setTheme: (theme: any) => void;
  
  // Utility functions
  showToast: (message: string) => void;
  showNotification: (title: string, body: string) => void;
  
  // Event system
  subscribe: (event: string, callback: (...args: any[]) => void) => () => void;
  unsubscribe: (event: string, callback: (...args: any[]) => void) => void;
  emit: (event: string, ...args: any[]) => void;
}

export interface Plugin {
  metadata: PluginMetadata;
  init: (api: PluginAPI) => void | Promise<void>;
  destroy: () => void | Promise<void>;
  onActivate?: () => void | Promise<void>;
  onDeactivate?: () => void | Promise<void>;
}

export interface PluginConfig {
  enabled: boolean;
  permissions: string[];
  settings?: Record<string, any>;
}

// Main plugin manager class
export class PluginManager {
  private static instance: PluginManager;
  private plugins: Map<string, Plugin> = new Map();
  private pluginConfigs: Map<string, PluginConfig> = new Map();
  private api: PluginAPI;
  private eventListeners: Map<string, Set<(args: any) => void>> = new Map();

  static getInstance(): PluginManager {
    if (!PluginManager.instance) {
      PluginManager.instance = new PluginManager();
    }
    return PluginManager.instance;
  }

  constructor() {
    this.api = this.createAPI();
  }

  /**
   * Create the plugin API
   */
  private createAPI(): PluginAPI {
    return {
      // Canvas manipulation
      getCanvas: () => useEditorStore.getState().canvas,
      addShape: (shape: fabric.Object) => {
        const canvas = useEditorStore.getState().canvas;
        if (canvas) {
          canvas.add(shape);
          canvas.requestRenderAll();
          this.emit('canvas.updated', { action: 'add', object: shape });
        }
      },
      removeObject: (objectId: string) => {
        const canvas = useEditorStore.getState().canvas;
        if (canvas) {
          const object = canvas.getObjects().find(obj => (obj as any).id === objectId);
          if (object) {
            canvas.remove(object);
            canvas.requestRenderAll();
            this.emit('canvas.updated', { action: 'remove', objectId });
          }
        }
      },
      getObjects: () => {
        const canvas = useEditorStore.getState().canvas;
        return canvas ? canvas.getObjects() : [];
      },
      
      // State management
      getState: () => useEditorStore.getState(),
      setState: (state: any) => {
        useEditorStore.setState(state);
      },
      
      // Theme management
      getTheme: () => {
        const { themeData } = this.getThemeStoreState();
        return themeData;
      },
      setTheme: (theme: any) => {
        const { setThemeData } = this.getThemeStoreState();
        setThemeData(theme);
      },
      
      // Utility functions
      showToast: (message: string) => {
        useEditorStore.getState().setToastMessage(message);
      },
      showNotification: (title: string, body: string) => {
        // Use the browser's Notification API if available
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
          Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
              new Notification(title, { body });
            }
          });
        }
        // Fallback: use the editor's toast system
        useEditorStore.getState().setToastMessage(`${title}: ${body}`);
      },
      
      // Event system
      subscribe: (event: string, callback: (...args: any[]) => void) => {
        if (!this.eventListeners.has(event)) {
          this.eventListeners.set(event, new Set());
        }
        this.eventListeners.get(event)!.add(callback);
        
        // Return unsubscribe function
        return () => {
          const listeners = this.eventListeners.get(event);
          if (listeners) {
            listeners.delete(callback);
            if (listeners.size === 0) {
              this.eventListeners.delete(event);
            }
          }
        };
      },
      unsubscribe: (event: string, callback: (...args: any[]) => void) => {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this.eventListeners.delete(event);
          }
        }
      },
      emit: (event: string, ...args: any[]) => {
        const listeners = this.eventListeners.get(event);
        if (listeners) {
          listeners.forEach(callback => {
            try {
              (callback as any)(...args);
            } catch (error) {
              console.error(`Error in event listener for ${event}:`, error);
            }
          });
        }
      },
    };
  }

  /**
   * Get theme store state and actions
   */
  private getThemeStoreState(): any {
    // This would import from the actual theme store
    // For now, returning a mock implementation
    return {
      themeData: null,
      setThemeData: () => {},
    };
  }

  /**
   * Register a plugin
   */
  async registerPlugin(plugin: Plugin): Promise<void> {
    if (this.plugins.has(plugin.metadata.id)) {
      console.warn(`Plugin with ID ${plugin.metadata.id} is already registered`);
      return;
    }

    // Set default configuration
    const defaultConfig: PluginConfig = {
      enabled: true,
      permissions: [],
    };

    this.pluginConfigs.set(plugin.metadata.id, defaultConfig);
    this.plugins.set(plugin.metadata.id, plugin);

    // Initialize the plugin if it's enabled
    const config = this.pluginConfigs.get(plugin.metadata.id)!;
    if (config.enabled) {
      try {
        await plugin.init(this.api);
        console.log(`Plugin ${plugin.metadata.name} initialized successfully`);
      } catch (error) {
        console.error(`Failed to initialize plugin ${plugin.metadata.name}:`, error);
      }
    }
  }

  /**
   * Unregister a plugin
   */
  async unregisterPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.warn(`Plugin with ID ${pluginId} is not registered`);
      return;
    }

    // Call the destroy method if it exists
    if (plugin.destroy) {
      try {
        await plugin.destroy();
      } catch (error) {
        console.error(`Error destroying plugin ${pluginId}:`, error);
      }
    }

    // Remove the plugin
    this.plugins.delete(pluginId);
    this.pluginConfigs.delete(pluginId);

    console.log(`Plugin ${pluginId} unregistered successfully`);
  }

  /**
   * Activate a plugin
   */
  async activatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.error(`Plugin with ID ${pluginId} not found`);
      return false;
    }

    const config = this.pluginConfigs.get(pluginId);
    if (!config) {
      console.error(`Configuration for plugin ${pluginId} not found`);
      return false;
    }

    // Update config
    config.enabled = true;
    this.pluginConfigs.set(pluginId, config);

    // Initialize the plugin
    try {
      await plugin.init(this.api);
      if (plugin.onActivate) {
        await plugin.onActivate();
      }
      console.log(`Plugin ${pluginId} activated successfully`);
      return true;
    } catch (error) {
      console.error(`Failed to activate plugin ${pluginId}:`, error);
      return false;
    }
  }

  /**
   * Deactivate a plugin
   */
  async deactivatePlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      console.error(`Plugin with ID ${pluginId} not found`);
      return false;
    }

    const config = this.pluginConfigs.get(pluginId);
    if (!config) {
      console.error(`Configuration for plugin ${pluginId} not found`);
      return false;
    }

    // Update config
    config.enabled = false;
    this.pluginConfigs.set(pluginId, config);

    // Call deactivate callback if it exists
    if (plugin.onDeactivate) {
      try {
        await plugin.onDeactivate();
      } catch (error) {
        console.error(`Error deactivating plugin ${pluginId}:`, error);
      }
    }

    console.log(`Plugin ${pluginId} deactivated successfully`);
    return true;
  }

  /**
   * Get a plugin by ID
   */
  getPlugin(pluginId: string): Plugin | null {
    return this.plugins.get(pluginId) || null;
  }

  /**
   * Get all registered plugins
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugin configuration
   */
  getPluginConfig(pluginId: string): PluginConfig | null {
    return this.pluginConfigs.get(pluginId) || null;
  }

  /**
   * Update plugin configuration
   */
  updatePluginConfig(pluginId: string, config: Partial<PluginConfig>): boolean {
    const existingConfig = this.pluginConfigs.get(pluginId);
    if (!existingConfig) {
      console.error(`Configuration for plugin ${pluginId} not found`);
      return false;
    }

    const newConfig = { ...existingConfig, ...config };
    this.pluginConfigs.set(pluginId, newConfig);
    return true;
  }

  /**
   * Check if a plugin is enabled
   */
  isPluginEnabled(pluginId: string): boolean {
    const config = this.pluginConfigs.get(pluginId);
    return config ? config.enabled : false;
  }

  /**
   * Load plugins from a manifest
   */
  async loadPluginsFromManifest(manifest: { plugins: Plugin[] }): Promise<void> {
    for (const plugin of manifest.plugins) {
      await this.registerPlugin(plugin);
    }
  }

  /**
   * Emit an event to all listeners
   */
  emit(event: string, ...args: any[]): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          (callback as any)(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }
}

// Create a singleton instance
export const pluginManager = PluginManager.getInstance();

// Define common events that plugins can listen to
export const PLUGIN_EVENTS = {
  CANVAS_UPDATED: 'canvas.updated',
  OBJECT_ADDED: 'object.added',
  OBJECT_REMOVED: 'object.removed',
  OBJECT_MODIFIED: 'object.modified',
  THEME_CHANGED: 'theme.changed',
  SELECTION_CHANGED: 'selection.changed',
  UNDO_REDO: 'undo.redo',
  PROJECT_SAVED: 'project.saved',
  PROJECT_LOADED: 'project.loaded',
} as const;