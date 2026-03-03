import type { Plugin } from '../utils/pluginArchitecture';

export const samplePlugin: Plugin = {
  metadata: {
    id: 'sample-audit-plugin',
    name: 'Sample Audit Plugin',
    version: '1.0.0',
    author: 'Codex',
    description: 'Validates the plugin API by reacting to object, export, and theme hooks.',
  },
  init(api) {
    api.showToast('Sample plugin ready');
  },
  hooks: {
    onObjectAdded(object) {
      if (object?.id) {
        console.info('[sample-plugin] object added', object.id);
      }
    },
    onExport(payload) {
      console.info('[sample-plugin] export requested', payload);
    },
    onThemeChange(theme) {
      console.info('[sample-plugin] theme changed', theme?.meta?.name ?? 'unknown');
    },
  },
};
