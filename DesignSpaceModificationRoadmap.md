DesignSpace Modification Roadmap

This roadmap translates the high‑level recommendations from the audit into actionable steps for a local large language model or developer to modify files within the DesignSpace repository. Tasks are grouped by theme; each task includes concrete file names and guidance for implementation.

Note: These steps assume familiarity with TypeScript/React and the DesignSpace code structure. When modifying code, use atomic commits and run the test suite after each major change. For modules not yet present, create new files in the indicated directories.

1. Complete the Single‑Source‑of‑Truth Migration

The goal is to make the Zustand store (canvasObjects and related state) the sole authority for canvas data, with Fabric.js acting only as a render delegate.

1.1. Identify Direct Canvas Mutations

Search the repository for direct calls to Fabric.js methods (e.g., canvas.add, canvas.remove, canvas.getObjects(), obj.set(...)) outside the editorStore actions. Key files include:

src/editor/components/CanvasStage.tsx

src/editor/utils/canvasUtils.ts

src/editor/fabric/smartGuides.ts

src/editor/fabric/canvasEventHandlers.ts (if present)

For each direct mutation:

Replace the direct call with a corresponding action dispatched through editorStore. For example, instead of canvas.add(newObj), call editorStore.getState().addObject(newObjSerialized), where addObject serializes the object to SerializedFabricObject and updates canvasObjects.

Update the canvas by listening to changes in canvasObjects via a useEffect hook. When canvasObjects changes, call canvas.loadFromJSON(...) or incremental updates to sync Fabric.

Remove any code that reads object properties directly from Fabric (e.g., const objs = canvas.getObjects()). Instead, read from canvasObjects via the store or selectors.

1.2. Implement layerSyncHandler

Create a new file src/editor/state/layerSyncHandler.ts. This module should:

Accept the current canvasObjects and the active Fabric canvas.

Compare the z‑order, properties and presence of objects on the canvas with the store.

Apply minimal operations to Fabric (add/remove/update objects) to mirror the store.

Enforce the zIndexManifest when adding objects (see §3).

Call layerSyncHandler from within editorStore actions such as setCanvasObjects, undo, redo and after bulk operations (import/export).

1.3. Enforce syncLock

Ensure every store action that triggers canvas synchronization uses the acquireSyncLock and releaseSyncLock methods defined in editorStore.ts. This prevents concurrent writes. Audit functions like loadFromJSON, requestLayerSync, batch operations and wrap them with the lock when missing.

2. Integrate the Unified Frame Scheduler
2.1. Replace requestAnimationFrame

Identify all uses of requestAnimationFrame or manual setTimeout loops. In each case:

Import the scheduler: import { frameScheduler, TaskPriority } from '../utils/frameScheduler';.

Wrap the scheduled function: frameScheduler.scheduleTask(() => {/* original code */}, TaskPriority.Normal);.

Remove any ad‑hoc cancellation logic; cancel tasks via the scheduler if necessary.

Examples:

In CanvasStage.tsx, replace calls to scheduleUpdate() or direct raf with frameScheduler.scheduleTask(updateCanvas, TaskPriority.High).

In animation or snapping modules (smartGuides.ts), schedule visual updates with TaskPriority.Low.

2.2. Adjust Circuit Breaker

Within CanvasStage.tsx, review the circuit breaker that counts forced re‑render attempts. Lower the thresholds if the scheduler successfully thins out updates. Ensure that persistCountRef and related counters are reset appropriately when tasks succeed.

3. Finalize Coordinate and Layering Systems
3.1. Use CoordinateSystem

Locate all occurrences of canvas.getZoom(), canvas.setZoom() or manual scaling calculations. Replace them with methods from src/editor/utils/coordinateSystem.ts:

To get the current zoom: const { zoom } = coordinateSystem.getState();

To set zoom: coordinateSystem.setZoom(newZoom);

To convert user units (inches/mm) to Fabric pixels: coordinateSystem.toFabricUnits(value, unitMode);

Ensure that canvas.resize(), object positioning, and export functions all rely on these conversions.

3.2. Enforce zIndexManifest

When creating, grouping or exporting objects, assign a z‑index based on src/editor/fabric/zIndexManifest.ts. For example:

Document paper: ZIndexLayer.DocumentPaper.

Content elements: ZIndexLayer.Content.

Guides and grids: ZIndexLayer.Guides.

Modify object creation functions (addText, addImage, addShape in the store or UI components) to include zIndex in the serialized object and to call enforceZOrder after adding.

3.3. User Controls for Units and Safe Zones

Create a new component CanvasSettingsPanel.tsx with options to:

Select unit mode (px, in, mm) via a dropdown that calls coordinateSystem.setMode().

Toggle safe zone overlays (bleed and margin). Persist the choice in the store.

Render this panel in CanvasStage or in a toolbar. Update the coordinateSystem when the user changes units.

4. Upgrade Dependencies and Add Tests
4.1. Update Package Versions

In package.json, update react and react-dom to ^19.2.0, zustand to ^5.x, tailwindcss to ^4.x and @types/react accordingly. Update fabric to the latest stable version compatible with React 19.

Run npm install and fix any TypeScript errors or breaking API changes (e.g., new Suspense behaviour in React 19).

4.2. Add Testing Infrastructure

Install test tools: Add vitest, @testing-library/react, jsdom, and @vitest/coverage-v8.

Configure Vitest: Create vitest.config.ts at the project root with TypeScript support and JSDOM environment.

Expand tests: Use the existing test suite in __tests__/testSuite.test.ts as a model. For each module:

Write unit tests for state actions (e.g., setCanvas, addObject, undo/redo).

Test the frame scheduler: ensure tasks execute in order of priority.

Test coordinate conversions in coordinateSystem.

Test z‑index enforcement and ordering in zIndexManifest.

CI Integration: Add a script in package.json:

"scripts": {
  "test": "vitest run",
  "validate": "node validate-functionality.js"
}

Configure your CI pipeline to run npm run test && npm run validate on pull requests.

5. Implement Missing Managers
5.1. History Snapshot Manager

Create src/editor/history/historySnapshotManager.ts with a class HistorySnapshotManager that:

Maintains a stack of past canvasObjects states and a current index.

Provides pushSnapshot(state), undo(), redo() methods.

Integrates with editorStore by dispatching snapshots after each action (except undo/redo themselves).

Update editorStore.ts to depend on HistorySnapshotManager. Remove ad‑hoc history arrays scattered throughout the store.

5.2. Advanced Export Manager

Create src/editor/export/advancedExportManager.ts:

Provide methods to export as PDF, SVG and PNG. Use fabric.Canvas.toSVG() and canvasToBlob() as needed.

Integrate unit scaling and bleed options via coordinateSystem. Respect z‑index when layering content.

Allow specifying export DPI and page sizes.

Modify ExportModal.tsx to call this manager rather than directly invoking buildExportCanvasData.

5.3. PWA Offline Manager

Create src/editor/offline/pwaOfflineManager.ts with a service worker registration and IndexedDB persistence:

On first load, register a service worker that caches assets and the last canvasObjects state.

Provide saveOfflineState(state) and loadOfflineState() functions to persist and restore the editor state when offline.

Display a banner when offline and provide a restore button.

5.4. Collaborative Editing Manager

Create src/editor/collaboration/collaborativeEditingManager.ts:

Use WebSocket or WebRTC to broadcast state changes (canvasObjects, selection state) to other clients in the same session.

Implement a conflict resolution mechanism (e.g., operational transforms or CRDTs) to merge concurrent edits.

Provide a UI panel showing active collaborators and their cursors.

6. Expand the Plugin Architecture
6.1. Finalize Theme Store Integration

In pluginArchitecture.ts, implement getThemeStoreState() by importing the theme store from src/editor/state/themeStore.ts (create this store if needed). Expose functions for plugins to read theme values and subscribe to changes.

6.2. Initialize Plugin Manager

In src/editor/App.tsx or the top‑level provider component:

Instantiate const pluginManager = new PluginManager();.

Register built‑in plugins (e.g., a color palette generator or accessibility plugin) using pluginManager.registerPlugin().

Pass pluginManager through React context so child components can dispatch plugin events.

6.3. Define Plugin Hooks

Extend PluginManager to emit hooks for events such as:

onObjectAdded(object): after a new object is added.

onExport(config): before an export starts.

onThemeChange(theme): when the theme changes.

Plugins can subscribe to these hooks and modify behaviour or UI accordingly.

7. Integrate AI Layout Suggestions
7.1. Suggestion Sidebar

Create a component SuggestionSidebar.tsx that displays a list of suggestions returned by aiLayoutSuggestions.ts along with actionable buttons (e.g., “Apply”, “Dismiss”). Include this sidebar in CanvasStage.tsx and provide a button or hotkey to toggle it.

7.2. Trigger Suggestions

Modify relevant actions in editorStore (e.g., after adding or moving objects) to call generateSuggestions(objects) from aiLayoutSuggestions.ts. Store the returned suggestions in editorStore so they can be consumed by SuggestionSidebar.

7.3. Apply Suggestions

Implement functions (e.g., applySuggestion(suggestionId)) that modify canvasObjects according to the suggestion. Ensure these modifications follow the single‑source‑of‑truth pattern (update the store first, then sync the canvas).

8. Enhance Accessibility and User Settings
8.1. Accessibility Settings Panel

Create AccessibilityPanel.tsx with controls to enable high‑contrast, dyslexia‑friendly fonts, reduced motion and large text. Bind these settings to AccessibilityManager methods in src/editor/utils/accessibilityModes.ts. Store user preferences in local storage or the store for persistence.

8.2. Keyboard and Screen Reader Support

Audit interactive components (buttons, sliders, modals) to ensure they are focusable and have appropriate ARIA roles and labels. Use the applyAccessibilityAttributes function where necessary. Add keyboard shortcuts for common actions (copy, paste, undo, redo) and announce changes to screen readers.

9. Improve Error Handling and User Feedback
9.1. Global Error Boundary

Create a component ErrorBoundary.tsx that wraps the application and catches runtime errors. Display a fallback UI and provide a button to reload the editor. Log errors to a monitoring service (e.g., Sentry) if configured.

9.2. Notification System

Add a NotificationContext or integrate a library like react-toastify. Expose methods notifyError(message), notifySuccess(message). Use this system in asynchronous actions (e.g., export, undo/redo, sync errors) to inform the user about success or failure.

9.3. Surface Validation Script

Integrate validate-functionality.js into the CI pipeline as described in §4.2. If the script fails, display a warning toast in development builds and fail the CI step.

10. Plan for Scalability and Marketplace
10.1. API Design

For features like collaboration and template marketplace, design REST/GraphQL endpoints on the server. Define data models for projects, templates, users and sessions. Use environment variables to configure endpoints in the client (src/config.ts).

10.2. Modular Architecture

Consider splitting large components (e.g., CanvasStage.tsx) into smaller micro‑frontends or dynamically loaded modules. Use React’s lazy() and Suspense to reduce initial load time. Organize code into domains (editor, export, history, plugins) to support independent development and testing.

10.3. Template Marketplace

Implement a marketplace page with search, categories and template previews. Use API calls to fetch template metadata. Allow users to purchase or import templates into their workspace. Hook purchases into your payment provider.

This roadmap provides a structured plan to address technical debt, integrate new features, and enhance reliability. By following these steps, the DesignSpace project can evolve into a robust, modern and extensible design editor.