# HEARTBEAT RESTORATION ROADMAP
## Design Space - State Synchronization Stabilization

**Document Version:** 1.0
**Date:** 2026-01-09
**Status:** 🔴 PLANNING PHASE - NO CODE CHANGES YET
**Primary Goal:** Stabilize the Zustand ↔ Fabric.js synchronization pipeline

---

## EXECUTIVE SUMMARY

This roadmap addresses the 10 critical findings from the Forensic Audit Report. The core strategy is to establish **Zustand as the primary source of truth** with Fabric.js as a **rendering delegate**. The refactor will proceed in 4 phases to minimize risk and maintain functionality throughout the transition.

### Success Criteria
- ✅ Zero divergence between Zustand state and canvas rendering
- ✅ No infinite re-render loops under any circumstance
- ✅ Clean mount/unmount lifecycle with no memory leaks
- ✅ Deterministic guide rendering order
- ✅ Accurate coordinate transforms across unit modes

---

## ARCHITECTURE PHILOSOPHY

### Current State (Fragile)
```
Zustand Store ←→ Fabric.js Canvas
   (Truth A)  ⚡️  (Truth B)

Both compete for authority, causing desync
```

### Target State (Stable)
```
Zustand Store (PRIMARY)
    ↓ Commands
Fabric.js Canvas (RENDER DELEGATE)
    ↑ Events (read-only)

Single source of truth, unidirectional flow
```

### Principles
1. **Single Source of Truth:** Zustand state is authoritative
2. **Immutable Canvas Reads:** Fabric events notify but don't modify state directly
3. **Atomic Operations:** Initialization and cleanup are indivisible
4. **Defensive Programming:** Every sync operation validates preconditions
5. **Observable Lifecycle:** All state transitions emit clear signals

---

## PHASE 1: INITIALIZATION & DISPOSAL SAFETY
**Duration Estimate:** 2-3 days
**Risk Level:** 🟡 MEDIUM
**Audit Findings Addressed:** #2, #4

### Objectives
1. Eliminate the race condition between canvas creation and sync handler registration
2. Prevent operations on disposed canvases
3. Ensure deterministic initialization order

---

### Task 1.1: Atomic Initialization Sequence

**Problem:**
Currently, canvas is set in the store BEFORE the layer sync handler is registered, creating a 2-5ms race window where theme application can trigger sync with a null handler.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:428-430`
```typescript
setLayerSyncHandler(() => scheduleUpdate(canvas));
setCanvas(canvas);  // ⚠️ Handler exists but canvas is already set
```

**Solution Design:**
```
┌─────────────────────────────────────┐
│ Atomic Initialization Block         │
├─────────────────────────────────────┤
│ 1. Create Fabric.js canvas instance │
│ 2. Register ALL event handlers      │
│ 3. Register layer sync handler      │
│ 4. Register cleanup callback        │
│ 5. Set canvas in store (atomic)     │
│ 6. Trigger initial sync (safe now)  │
└─────────────────────────────────────┘
```

**Implementation Strategy:**
- Create a `useCanvasLifecycle` custom hook that encapsulates the entire init sequence
- Use a ref flag `isInitializing` to prevent concurrent inits
- Wrap steps 1-6 in a non-interruptible sequence
- Only call `setCanvas()` after ALL prerequisites are met

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (primary refactor)
- `src/editor/state/editorStore.ts` (add `canvasReadyState` enum)

**New State Properties:**
```typescript
// Add to EditorState interface
canvasReadyState: 'uninitialized' | 'initializing' | 'ready' | 'disposing' | 'disposed';
```

**Safety Checks:**
- [ ] Verify sync handler exists before calling `setCanvas()`
- [ ] Confirm canvas is NOT null when `canvasReadyState === 'ready'`
- [ ] Test rapid mount/unmount (10x in 1 second) - no errors
- [ ] Verify theme application waits until `canvasReadyState === 'ready'`

---

### Task 1.2: Cancellation Token for Cleanup

**Problem:**
Async cleanup promise continues executing after component unmount, causing disposal operations on already-disposed canvases.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:405-408, 692-700`

**Solution Design:**
```
┌──────────────────────────────────────────┐
│ Cleanup Lifecycle                         │
├──────────────────────────────────────────┤
│ 1. Set canvasReadyState = 'disposing'    │
│ 2. Create cancellation token (AbortSignal)│
│ 3. Remove ALL event listeners            │
│ 4. Clear ALL RAF callbacks                │
│ 5. Set layerSyncHandler = null           │
│ 6. Dispose Fabric canvas (if !cancelled) │
│ 7. Set canvasReadyState = 'disposed'     │
│ 8. Revoke object URLs (cleanup assets)   │
└──────────────────────────────────────────┘
```

**Implementation Strategy:**
- Introduce `cleanupAbortControllerRef` using Web `AbortController` API
- Check `signal.aborted` before every async operation
- Replace `isCancelledRef` with proper signal checking
- Ensure `canvas.dispose()` is only called once, guarded by state check

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (cleanup function rewrite)
- `src/editor/state/editorStore.ts` (add disposal state tracking)

**Refactor Pattern:**
```typescript
// OLD (fragile)
if (isCancelledRef.current) return;
await someAsyncOp();

// NEW (safe)
if (abortSignal.aborted) return;
await someAsyncOp();
if (abortSignal.aborted) return; // Check after every await
```

**Safety Checks:**
- [ ] Rapid mount/unmount 100x - no console errors
- [ ] Memory leak test: mount/unmount 1000x, check heap size
- [ ] Verify `canvas.dispose()` is called exactly once per lifecycle
- [ ] Confirm no RAF callbacks fire after disposal
- [ ] Check that `pendingPromisesRef` is cleared

---

### Task 1.3: Initialization Gate for Theme Application

**Problem:**
`applyActiveThemeToCanvas()` can be called before canvas is fully initialized with objects.

**Current Code Location:**
`src/editor/state/editorStore.ts:407-409`

**Solution Design:**
- Theme application must check `canvasReadyState === 'ready'`
- Queue theme application if canvas is still initializing
- Apply theme AFTER objects are loaded in `loadTemplate` and `loadProjectFile`

**Files to Modify:**
- `src/editor/state/editorStore.ts` (`setCanvas`, `applyTheme`)
- `src/editor/fabric/themeUtils.ts` (add readiness check)

**New Helper Function:**
```typescript
const safeApplyTheme = (theme: ApocapaletteTheme) => {
  const { canvas, canvasReadyState } = get();
  if (canvasReadyState !== 'ready' || !canvas) {
    // Queue for later or skip
    return;
  }
  applyActiveThemeToCanvas();
};
```

**Safety Checks:**
- [ ] Load template with theme - verify theme applies AFTER objects render
- [ ] Switch themes rapidly (10x/sec) - no crashes
- [ ] Load project file - theme applies to correct object set

---

### Phase 1 Success Metrics

**Automated Tests:**
- [ ] Unit test: `useCanvasLifecycle` hook with mock Fabric canvas
- [ ] Integration test: Full CanvasStage mount/unmount cycle
- [ ] Stress test: 1000 rapid mounts, check for memory leaks

**Manual Verification:**
- [ ] Open DevTools → Performance tab
- [ ] Record while mounting/unmounting canvas 50x
- [ ] Verify no "Detached DOM nodes" warnings
- [ ] Check RAF callbacks drop to zero after unmount

**Rollback Plan:**
If issues arise, revert to synchronous initialization with explicit ordering comments.

---

## PHASE 2: SOURCE OF TRUTH CONSOLIDATION
**Duration Estimate:** 4-5 days
**Risk Level:** 🔴 HIGH
**Audit Findings Addressed:** #1, #3, #5

### Objectives
1. Establish Zustand as the primary source of truth
2. Prevent sync operations during sensitive windows
3. Convert binary persist flag to counter-based system

---

### Task 2.1: Zustand-First Architecture

**Problem:**
The system maintains two competing sources of truth. Sometimes Zustand leads, sometimes Fabric leads.

**Current State:**
```
User Action → Fabric Canvas → scheduleUpdate → Reads Fabric → Updates Zustand
                   ↓
            (Objects live here)
```

**Target State:**
```
User Action → Zustand Store → scheduleRender → Fabric Canvas
                   ↓
         (Objects stored here as serializable data)
```

**Solution Design:**

**Step 2.1.1: Create Serialized Object Store**

Add to `editorStore.ts`:
```typescript
interface EditorState {
  // NEW: Primary object storage
  canvasObjects: SerializedFabricObject[];  // Source of truth

  // EXISTING (becomes derived state)
  layers: Layer[];  // Derived from canvasObjects
  layersById: Record<string, fabric.Object>;  // Cached Fabric instances
}
```

**Step 2.1.2: Implement Unidirectional Sync**

Replace bidirectional sync with command pattern:
```
Command: addObject(serializedObject)
  ↓
Update Zustand: canvasObjects.push(serializedObject)
  ↓
Sync to Fabric: deserialize → canvas.add(object)
  ↓
Update layers: derive from canvasObjects
```

**Files to Modify:**
- `src/editor/state/editorStore.ts` (add `canvasObjects` array)
- `src/editor/components/CanvasStage.tsx` (change sync direction)
- `src/editor/fabric/objectFactories.ts` (return serialized objects)
- `src/editor/utils/serialization.ts` (expand utilities)

**Migration Strategy:**

**Week 1: Dual-Write Mode**
- Add `canvasObjects` array to store
- On every change, write to BOTH Fabric AND `canvasObjects`
- Keep existing sync for safety

**Week 2: Validation Mode**
- After each operation, compare Fabric state to `canvasObjects`
- Log any divergences (don't fix yet)
- Collect metrics

**Week 3: Zustand-Primary Mode**
- Switch reads to come from `canvasObjects`
- Fabric becomes write-only (rendering)
- Remove old sync logic

**Safety Checks:**
- [ ] Load 100-object canvas - verify all objects render
- [ ] Undo/redo 50 times - confirm state matches
- [ ] Add object → modify → delete - check `canvasObjects` updates
- [ ] Compare `canvasObjects` to `canvas.getObjects()` after 100 operations

---

### Task 2.2: Sync Lock Mechanism

**Problem:**
`requestLayerSync()` can be called during initialization, theme switching, or undo/redo, causing race conditions.

**Current Code Location:**
`src/editor/state/editorStore.ts:462-469`

**Solution Design:**

Add sync lock state:
```typescript
interface EditorState {
  syncLock: {
    isLocked: boolean;
    reason: 'init' | 'theme-apply' | 'undo' | 'redo' | 'batch' | null;
    queuedSync: boolean;
  };
}
```

**Lock Acquisition Pattern:**
```typescript
// Before sensitive operation
acquireSyncLock('theme-apply');
try {
  // ... apply theme ...
} finally {
  releaseSyncLock();
  // If sync was queued, run it now
}
```

**Implementation Strategy:**
- Wrap sensitive operations with lock/unlock
- Queue sync requests during lock
- Drain queue when lock releases

**Files to Modify:**
- `src/editor/state/editorStore.ts` (add lock state + helpers)
- `src/editor/components/CanvasStage.tsx` (acquire lock during init)
- `src/editor/fabric/themeUtils.ts` (lock during theme apply)

**Lock Points:**
1. Canvas initialization (lock: 'init')
2. Theme application (lock: 'theme-apply')
3. Undo operation (lock: 'undo')
4. Redo operation (lock: 'redo')
5. Template load (lock: 'init')
6. Project file load (lock: 'init')

**Safety Checks:**
- [ ] Apply theme during undo - verify sync waits
- [ ] Load template while objects are being added - no race
- [ ] Stress test: 1000 rapid lock/unlock cycles
- [ ] Verify lock is ALWAYS released (even on error)

---

### Task 2.3: Counter-Based Persistence System

**Problem:**
Binary `persistScheduledRef` flag can be overwritten, causing lost history snapshots.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:116-119`

**Solution Design:**

Replace binary flag with counter:
```typescript
// OLD
persistScheduledRef.current = true;  // ❌ Can be lost

// NEW
persistCountRef.current += 1;  // ✅ Accumulates
```

**Logic:**
```typescript
const scheduleUpdate = (options?: { persist?: boolean }) => {
  if (options?.persist) {
    persistCountRef.current += 1;
  }

  // Later, in RAF callback:
  if (persistCountRef.current > 0) {
    persistCountRef.current = 0;  // Reset counter
    saveState();
  }
};
```

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (update scheduleUpdate logic)

**Edge Cases to Handle:**
- Counter overflow (unlikely, but cap at 100)
- Multiple persist requests in single frame (should trigger ONE save)
- Persist requested during batch (increment counter, save after batch)

**Safety Checks:**
- [ ] Call `scheduleUpdate({ persist: true })` 10x rapidly - ONE save occurs
- [ ] Mix persist and non-persist calls - persist wins
- [ ] Verify history length after 100 operations matches expected
- [ ] Test batch mode: persist during batch → save fires after batch ends

---

### Task 2.4: Fabric Event Handlers as Read-Only Observers

**Problem:**
Fabric events directly call `scheduleUpdate({ persist: true })`, bypassing store actions.

**Current Code Location:**
- `CanvasStage.tsx:432-458` (object:added, object:modified, etc.)

**Solution Design:**

Convert event handlers to dispatch store actions:
```typescript
// OLD (direct modification)
const handleObjectAdded = (event) => {
  ensureObjectId(target, canvas);
  scheduleUpdate(canvas, { persist: true });  // ❌ Bypasses store
};

// NEW (store-mediated)
const handleObjectAdded = (event) => {
  const serialized = toSerializableObject(event.target);
  useEditorStore.getState().addCanvasObject(serialized);  // ✅ Goes through store
};
```

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (all event handlers)
- `src/editor/state/editorStore.ts` (add object mutation actions)

**New Store Actions:**
```typescript
// Add to EditorState
addCanvasObject: (obj: SerializedFabricObject) => void;
updateCanvasObject: (id: string, changes: Partial<SerializedFabricObject>) => void;
removeCanvasObject: (id: string) => void;
reorderCanvasObjects: (fromIndex: number, toIndex: number) => void;
```

**Safety Checks:**
- [ ] Add shape via toolbar - object appears in `canvasObjects`
- [ ] Modify object properties - `canvasObjects` updates
- [ ] Delete object - removed from `canvasObjects`
- [ ] Undo delete - object restored from `canvasObjects`

---

### Phase 2 Success Metrics

**Divergence Test:**
```typescript
// After every operation, check:
const fabricIds = canvas.getObjects().map(o => o.id).sort();
const storeIds = canvasObjects.map(o => o.id).sort();
assert.deepEqual(fabricIds, storeIds);  // Must ALWAYS match
```

**Performance Benchmarks:**
- [ ] 1000 object adds: < 2 seconds
- [ ] 100 undo/redo cycles: < 5 seconds
- [ ] Theme switch with 500 objects: < 1 second

**Manual Tests:**
- [ ] Open large project (500+ objects)
- [ ] Add, modify, delete objects randomly for 5 minutes
- [ ] Check DevTools → Application → LocalStorage - verify state persistence
- [ ] Reload page - verify exact state restoration

**Rollback Plan:**
If Zustand-first causes performance issues, keep dual-write mode with Fabric as primary. Add divergence detection but don't enforce Zustand authority yet.

---

## PHASE 3: STABILIZATION OF THE UPDATE LOOP
**Duration Estimate:** 3-4 days
**Risk Level:** 🔴 HIGH
**Audit Findings Addressed:** #6, #7

### Objectives
1. Eliminate infinite re-render loop risk
2. Unify multiple RAF queues into single cycle
3. Improve viewport recovery robustness

---

### Task 3.1: Bulletproof Guide Filtering

**Problem:**
`isCanvasInSync()` relies on filtering objects with `isGuide` property, but inconsistent tagging causes false negatives, triggering infinite force-rerender loops.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:263-276`

**Solution Design:**

**Step 3.1.1: Centralize Guide Object Registry**

Create a `GuideRegistry` class:
```typescript
class GuideRegistry {
  private guideIds = new Set<string>();

  register(obj: fabric.Object, type: GuideType): void {
    const id = (obj as any).__internalGuideId || uuidv4();
    (obj as any).__internalGuideId = id;
    this.guideIds.add(id);
  }

  unregister(obj: fabric.Object): void {
    const id = (obj as any).__internalGuideId;
    if (id) this.guideIds.delete(id);
  }

  isGuide(obj: fabric.Object): boolean {
    const id = (obj as any).__internalGuideId;
    return id ? this.guideIds.has(id) : false;
  }

  clear(): void {
    this.guideIds.clear();
  }
}
```

**Step 3.1.2: Update All Guide Creation Sites**

Modify all guide creation to register:
- Safe margin guides (canvasUtils.ts)
- Bleed guides (canvasUtils.ts)
- Trim lines (canvasUtils.ts)
- Smart guides (smartGuides.ts)
- Grid lines (smartGuides.ts)

**Files to Modify:**
- `src/editor/fabric/guideRegistry.ts` (NEW FILE)
- `src/editor/fabric/canvasUtils.ts` (use registry)
- `src/editor/fabric/smartGuides.ts` (use registry)
- `src/editor/components/CanvasStage.tsx` (use registry for filtering)

**Refactored Filtering:**
```typescript
// OLD (brittle)
const canvasIds = canvas.getObjects()
  .filter(obj => !(obj as any).isGuide)  // ❌ Relies on manual tagging
  .map(obj => obj.id);

// NEW (robust)
const canvasIds = canvas.getObjects()
  .filter(obj => !guideRegistry.isGuide(obj))  // ✅ Central authority
  .map(obj => obj.id);
```

**Safety Checks:**
- [ ] Create 100 objects + 50 guides - `isCanvasInSync()` returns true
- [ ] Toggle guides on/off 100x - sync never fails
- [ ] Force rerender manually - loop terminates after 1 iteration
- [ ] Add guide with missing `isGuide` tag - still filtered correctly

---

### Task 3.2: Unified RAF Cycle

**Problem:**
Multiple RAF queues (viewport update, offset calculation, layer sync, guide rendering) can conflict and cause redundant renders.

**Current Code Location:**
- `CanvasStage.tsx:122-155` (scheduleUpdate RAF)
- `smartGuides.tsx:253-256` (guide rendering RAF)

**Solution Design:**

Create single `FrameScheduler` class:
```typescript
class FrameScheduler {
  private rafId: number | null = null;
  private tasks = new Set<() => void>();

  schedule(task: () => void): void {
    this.tasks.add(task);
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  private flush(): void {
    const currentTasks = Array.from(this.tasks);
    this.tasks.clear();
    this.rafId = null;

    // Execute all tasks in order
    currentTasks.forEach(task => task());
  }

  cancel(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.tasks.clear();
  }
}
```

**Task Priorities:**
1. Update guides (must happen before render)
2. Update layers (derive from canvas)
3. Update viewport transform
4. Calculate canvas offset
5. Request render all

**Files to Modify:**
- `src/editor/utils/frameScheduler.ts` (NEW FILE)
- `src/editor/components/CanvasStage.tsx` (replace scheduleUpdate)
- `src/editor/fabric/smartGuides.ts` (use shared scheduler)

**Migration Strategy:**
- Replace `updateRafRef.current` with `frameScheduler.schedule()`
- Consolidate all RAF-scheduled work into priority-ordered tasks
- Remove duplicate `canvas.requestRenderAll()` calls

**Safety Checks:**
- [ ] Add 10 objects rapidly - only ONE render per frame
- [ ] Pan canvas - viewport updates batched
- [ ] Toggle guides - render happens AFTER guide update
- [ ] Performance test: 1000 operations should use ≤ 1000 RAFs (not 3000+)

---

### Task 3.3: Infinite Loop Circuit Breaker

**Problem:**
If `isCanvasInSync()` has a bug, `forceRerenderCanvas()` can loop infinitely.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:304-311`

**Solution Design:**

Add circuit breaker with exponential backoff:
```typescript
const maxForceRerenderAttempts = 3;
const forceRerenderAttemptsRef = useRef(0);
const forceRerenderBackoffRef = useRef<NodeJS.Timeout | null>(null);

useEffect(() => {
  if (!isCanvasInSync()) {
    forceRerenderAttemptsRef.current += 1;

    if (forceRerenderAttemptsRef.current > maxForceRerenderAttempts) {
      console.error('[FATAL] Canvas sync failed after 3 attempts. Manual intervention required.');
      // Set error state, notify user
      set({ syncError: 'Canvas sync failed' });
      return;
    }

    // Exponential backoff: 0ms, 100ms, 500ms
    const backoff = forceRerenderAttemptsRef.current === 1 ? 0 : 100 * Math.pow(5, forceRerenderAttemptsRef.current - 2);

    forceRerenderBackoffRef.current = setTimeout(() => {
      forceRerenderCanvas();
    }, backoff);

    return;
  }

  // Success - reset counter
  forceRerenderAttemptsRef.current = 0;
}, [isCanvasInSync, forceRerenderCanvas]);
```

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (add circuit breaker)
- `src/editor/state/editorStore.ts` (add `syncError` state)

**User Notification:**
If circuit breaker trips, show modal:
```
⚠️ Canvas Synchronization Error

The canvas failed to synchronize with the application state.
This is a rare condition. Please:

1. Save your work (Download Project)
2. Reload the page
3. Report this issue

[Download Project] [Reload Page] [Dismiss]
```

**Safety Checks:**
- [ ] Manually break `isCanvasInSync()` - circuit breaker activates
- [ ] Verify backoff delays (0ms, 100ms, 500ms)
- [ ] After 3 attempts, user sees error modal
- [ ] Test recovery: fix issue, reload page - works normally

---

### Task 3.4: Robust Viewport Recovery

**Problem:**
Current viewport recovery gives up after 2 attempts, leaving objects permanently off-screen.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:313-330`

**Solution Design:**

Replace attempt counter with smarter logic:
```typescript
const viewportRecovery = {
  enabled: true,
  reasonForFailure: null as string | null,

  attemptFocus(canvas, objects) {
    if (!this.enabled) return;

    if (objects.length === 0) {
      this.reasonForFailure = 'No objects to focus';
      return;
    }

    const bounds = getObjectsBounds(objects);
    if (!bounds) {
      this.reasonForFailure = 'Invalid object bounds';
      return;
    }

    // Calculate if objects are COMPLETELY off-screen
    const viewport = getViewportBounds(canvas);
    const completelyOffScreen = (
      bounds.right < viewport.left ||
      bounds.left > viewport.right ||
      bounds.bottom < viewport.top ||
      bounds.top > viewport.bottom
    );

    if (completelyOffScreen) {
      focusObjectsInView(canvas, objects);
      this.reasonForFailure = null;
    }
  },

  disable(reason: string) {
    this.enabled = false;
    this.reasonForFailure = reason;
  },

  enable() {
    this.enabled = true;
    this.reasonForFailure = null;
  }
};
```

**New Behavior:**
- Don't count attempts - check if recovery is NEEDED
- Only focus if objects are COMPLETELY off-screen (not partially visible)
- Allow manual disable (e.g., user intentionally panned away)
- Add status bar indicator: "Viewport: Objects off-screen (Auto-focus disabled)"

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (rewrite recovery logic)
- `src/editor/components/StatusBar.tsx` (add viewport status)

**User Controls:**
- If objects are off-screen, show button: "Focus All Objects" (manual trigger)
- In status bar, show: "Objects: 10 visible, 3 off-screen [Focus]"

**Safety Checks:**
- [ ] Load 100 objects spanning 5000x5000px - viewport focuses on center
- [ ] User pans away - recovery doesn't fight them
- [ ] Add object off-screen - recovery focuses on it
- [ ] Pan manually, add object on-screen - recovery doesn't interfere

---

### Phase 3 Success Metrics

**Loop Prevention:**
- [ ] Stress test: 10,000 operations - zero infinite loops
- [ ] Intentionally corrupt sync check - circuit breaker activates
- [ ] Monitor console for "[FATAL]" errors in production (should be 0)

**Performance:**
- [ ] Measure RAFs per operation: should be ~1.0 (not 2-3)
- [ ] Viewport focus time: < 100ms for 500 objects
- [ ] Guide toggle: < 16ms (single frame)

**Manual Testing:**
- [ ] Open project, spam "Ctrl+Z" 100x - no loops
- [ ] Toggle guides rapidly while panning - smooth operation
- [ ] Add 1000 objects in grid - viewport handles gracefully

**Rollback Plan:**
If circuit breaker triggers false positives, increase max attempts to 5 and add more detailed logging.

---

## PHASE 4: COORDINATE & LAYERING FIXES
**Duration Estimate:** 2-3 days
**Risk Level:** 🟡 MEDIUM
**Audit Findings Addressed:** #8, #9, #10

### Objectives
1. Prevent unit scale staleness during mode changes
2. Eliminate guide z-order conflicts
3. Fix canvas offset calculation drift

---

### Task 4.1: Centralized Unit Scale Management

**Problem:**
Unit scale changes can create stale references when zoom or pan operations are in flight.

**Current Code Location:**
`src/editor/state/editorStore.ts:480-489`

**Solution Design:**

Create `CoordinateSystem` class:
```typescript
class CoordinateSystem {
  private mode: UnitMode = 'px';
  private scale: number = 1;
  private zoom: number = 1;
  private lockCounter: number = 0;

  lock(): void {
    this.lockCounter += 1;
  }

  unlock(): void {
    this.lockCounter = Math.max(0, this.lockCounter - 1);
  }

  setMode(newMode: UnitMode): void {
    if (this.lockCounter > 0) {
      throw new Error('Cannot change unit mode while locked');
    }
    this.mode = newMode;
    this.scale = unitScaleMap[newMode];
    this.recalculate();
  }

  setZoom(newZoom: number): void {
    this.zoom = newZoom;
    this.recalculate();
  }

  private recalculate(): void {
    // Update unitZoom atomically
    const unitZoom = this.zoom * this.scale;
    useEditorStore.setState({
      unitScale: this.scale,
      unitZoom,
      zoom: this.zoom
    });
  }

  // Conversion helpers
  toCanvas(value: number): number {
    return value * this.scale;
  }

  fromCanvas(value: number): number {
    return value / this.scale;
  }
}
```

**Lock During Sensitive Operations:**
```typescript
// Pan operation
coordinateSystem.lock();
canvas.relativePan(new fabric.Point(deltaX, deltaY));
coordinateSystem.unlock();

// Zoom operation
coordinateSystem.lock();
canvas.zoomToPoint(point, newZoom);
coordinateSystem.unlock();
```

**Files to Modify:**
- `src/editor/utils/coordinateSystem.ts` (NEW FILE)
- `src/editor/state/editorStore.ts` (use CoordinateSystem)
- `src/editor/components/CanvasStage.tsx` (lock during pan/zoom)

**Safety Checks:**
- [ ] Change unit mode during pan - error thrown or operation completes atomically
- [ ] Rapid unit mode switches (10x/sec) - no stale values
- [ ] Zoom + unit change simultaneously - one blocks the other
- [ ] Verify `unitZoom` always equals `zoom * unitScale`

---

### Task 4.2: Z-Index Manifest for Guides

**Problem:**
Multiple guide systems (safe margin, bleed, smart guides) use conflicting z-order operations (`sendToBack`, `bringToFront`).

**Current Code Location:**
- `canvasUtils.ts:51-54, 119-122`
- `smartGuides.ts:48-49`

**Solution Design:**

Define z-index layers as constants:
```typescript
enum CanvasLayer {
  BLEED_ZONE = 0,           // Grey background for bleed
  TRIM_LINE = 1,            // White edge lines
  CONTENT_BACKGROUND = 10,  // User background objects
  CONTENT_NORMAL = 100,     // User objects (default)
  CONTENT_FOREGROUND = 200, // User foreground objects
  SAFE_MARGIN_GUIDES = 300, // Cyan dashed lines
  BLEED_GUIDES = 301,       // Red dashed lines
  SMART_GUIDES = 400,       // Purple snap lines (temporary)
  GRID_OVERLAY = 500,       // Grid (drawn on contextTop, not canvas)
}
```

**Implementation Strategy:**
- Add `__zIndex` property to all objects
- After adding any object, call `enforceZOrder(canvas)`
- Remove all `sendToBack()` and `bringToFront()` calls

**Enforce Z-Order Function:**
```typescript
function enforceZOrder(canvas: fabric.Canvas): void {
  const objects = canvas.getObjects();

  // Sort by __zIndex (default to CONTENT_NORMAL)
  const sorted = objects.sort((a, b) => {
    const zA = (a as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
    const zB = (b as any).__zIndex ?? CanvasLayer.CONTENT_NORMAL;
    return zA - zB;
  });

  // Reorder on canvas
  sorted.forEach((obj, index) => {
    canvas.moveTo(obj, index);
  });
}
```

**Files to Modify:**
- `src/editor/fabric/zIndexManifest.ts` (NEW FILE)
- `src/editor/fabric/canvasUtils.ts` (assign z-index to guides)
- `src/editor/fabric/smartGuides.ts` (assign z-index to smart guides)
- `src/editor/fabric/objectFactories.ts` (assign z-index to user objects)

**Safety Checks:**
- [ ] Create object → add guides → verify object is visible
- [ ] Toggle guides 100x - z-order never breaks
- [ ] Add 100 objects - guides stay on top
- [ ] Smart guides appear above content but below UI

---

### Task 4.3: Canvas Offset Drift Prevention

**Problem:**
Canvas offset is calculated from DOM rects with 0.5px threshold, causing accumulated rounding errors.

**Current Code Location:**
`src/editor/components/CanvasStage.tsx:130-148`

**Solution Design:**

**Option A: Increase threshold to 1px**
```typescript
const threshold = 1.0;  // Up from 0.5
if (Math.abs(nextOffset.x - prev.x) >= threshold) {
  // Update
}
```

**Option B: Use ResizeObserver for offset (more accurate)**
```typescript
const offsetObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { left, top } = entry.contentRect;
    updateCanvasOffset({ x: left, y: top });
  }
});
offsetObserver.observe(canvasRef.current);
```

**Option C: Calculate offset only on mount and resize (not every frame)**
```typescript
// Only update offset when:
// 1. Canvas initializes
// 2. Window resizes
// 3. Canvas dimensions change
// NOT on every RAF cycle
```

**Recommended: Option C + Option B**

**Files to Modify:**
- `src/editor/components/CanvasStage.tsx` (change offset calculation timing)

**Safety Checks:**
- [ ] Pan canvas 1000x - offset doesn't accumulate errors
- [ ] Resize window 100x - offset updates correctly
- [ ] Zoom in/out - offset remains accurate
- [ ] Multi-monitor setup - offset correct on all screens

---

### Task 4.4: Scale Zero Guard

**Problem:**
While unlikely in current code, no guard exists to prevent `unitScale` from becoming 0.

**Current Code Location:**
`src/editor/utils/units.ts:6-11`

**Solution Design:**

Add validation to scale map:
```typescript
export const unitScale: Record<UnitMode, number> = new Proxy(UNIT_SCALE_MAP, {
  get(target, prop: UnitMode) {
    const value = target[prop];
    if (value === 0 || !Number.isFinite(value)) {
      console.error(`[FATAL] Invalid unit scale for mode "${prop}": ${value}`);
      return 1; // Fallback to px
    }
    return value;
  }
});
```

Add validation to `setUnitMode`:
```typescript
setUnitMode: (mode) => {
  const nextScale = unitScale[mode];
  if (nextScale <= 0 || !Number.isFinite(nextScale)) {
    console.error(`Cannot set unit mode to "${mode}" - invalid scale: ${nextScale}`);
    return; // Abort
  }
  // ... rest of logic
}
```

**Files to Modify:**
- `src/editor/utils/units.ts` (add Proxy validation)
- `src/editor/state/editorStore.ts` (add scale validation)

**Safety Checks:**
- [ ] Manually set `unitScale[mode] = 0` - error logged, fallback to 1
- [ ] Set `unitScale[mode] = NaN` - error logged, fallback to 1
- [ ] Division by scale: `value / unitScale` - never divides by 0

---

### Phase 4 Success Metrics

**Coordinate Accuracy:**
- [ ] Switch unit modes 1000x - no NaN values
- [ ] Pan 10,000px, switch mode - position correct
- [ ] Zoom to 400%, switch mode - scale correct

**Guide Rendering:**
- [ ] Visual test: guides always behind content
- [ ] Add guides, toggle 100x - order never changes
- [ ] Smart guides appear/disappear correctly

**Offset Stability:**
- [ ] Record offset values during 1000 operations
- [ ] Max drift: < 2px over 10 minutes
- [ ] Resize window 100x - offset tracks perfectly

**Manual Testing:**
- [ ] Work in inches, zoom/pan, switch to cm - seamless
- [ ] Toggle guides while panning - no z-order glitches
- [ ] Multi-monitor: drag window between monitors - offset correct

**Rollback Plan:**
If CoordinateSystem causes performance issues, keep existing approach but add locking flags to prevent concurrent updates.

---

## CROSS-PHASE INTEGRATION

### Integration Point 1: Initialization + Source of Truth
- Phase 1 establishes atomic init
- Phase 2 populates `canvasObjects` during init
- Result: Canvas is initialized with Zustand as authority from frame 0

### Integration Point 2: Update Loop + Coordinate System
- Phase 3 unifies RAF cycles
- Phase 4 locks coordinates during operations
- Result: All updates happen in single frame with stable coordinates

### Integration Point 3: Sync Lock + Z-Index Enforcement
- Phase 2 introduces sync locking
- Phase 4 enforces z-order after operations
- Result: Z-order is enforced atomically, not interrupted by sync

---

## TESTING STRATEGY

### Unit Tests (Jest)
```typescript
// Example test structure
describe('CanvasStage Initialization', () => {
  it('should register sync handler before setting canvas', () => {
    const { result } = renderHook(() => useCanvasLifecycle());
    expect(result.current.syncHandler).toBeDefined();
    expect(result.current.canvas).toBeNull();

    act(() => result.current.initialize());

    expect(result.current.syncHandler).toBeDefined();
    expect(result.current.canvas).toBeDefined();
  });
});
```

### Integration Tests (React Testing Library + Fabric.js)
```typescript
describe('Canvas Synchronization', () => {
  it('should maintain sync between store and canvas after 100 operations', async () => {
    const { getByTestId } = render(<EditorShell />);
    const addButton = getByTestId('add-rectangle');

    for (let i = 0; i < 100; i++) {
      fireEvent.click(addButton);
      await waitFor(() => {
        const storeCount = useEditorStore.getState().canvasObjects.length;
        const canvasCount = useEditorStore.getState().canvas?.getObjects().length;
        expect(storeCount).toBe(canvasCount);
      });
    }
  });
});
```

### Visual Regression Tests (Playwright)
```typescript
test('guides render in correct z-order', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-testid="add-rectangle"]');
  await page.click('[data-testid="toggle-guides"]');

  // Take screenshot and compare to baseline
  await expect(page).toHaveScreenshot('guides-with-content.png');
});
```

### Performance Tests (Lighthouse + Custom Metrics)
```typescript
describe('Performance Benchmarks', () => {
  it('should render 1000 objects in < 2 seconds', async () => {
    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      useEditorStore.getState().addCanvasObject(createMockRectangle());
    }

    const end = performance.now();
    expect(end - start).toBeLessThan(2000);
  });
});
```

---

## ROLLOUT STRATEGY

### Week 1: Phase 1 (Initialization Safety)
- **Day 1-2:** Implement atomic init + cancellation token
- **Day 3:** Testing and bug fixes
- **Day 4:** Code review + merge to `feature/heartbeat-phase1`
- **Day 5:** Deploy to staging, monitor for errors

### Week 2: Phase 2 (Source of Truth - Part 1)
- **Day 1-2:** Add `canvasObjects` array, implement dual-write mode
- **Day 3-4:** Implement sync lock mechanism
- **Day 5:** Testing + merge to `feature/heartbeat-phase2a`

### Week 3: Phase 2 (Source of Truth - Part 2)
- **Day 1-2:** Switch to Zustand-primary mode
- **Day 3:** Implement counter-based persistence
- **Day 4:** Refactor Fabric event handlers to store actions
- **Day 5:** Testing + merge to `feature/heartbeat-phase2b`

### Week 4: Phase 3 (Update Loop Stabilization)
- **Day 1:** Implement GuideRegistry
- **Day 2:** Unified RAF scheduler
- **Day 3:** Circuit breaker + viewport recovery
- **Day 4-5:** Testing + merge to `feature/heartbeat-phase3`

### Week 5: Phase 4 (Coordinate & Layering)
- **Day 1:** CoordinateSystem class
- **Day 2:** Z-index manifest
- **Day 3:** Canvas offset fixes + scale guards
- **Day 4-5:** Testing + merge to `feature/heartbeat-phase4`

### Week 6: Integration & Final Testing
- **Day 1-2:** Merge all phases into `feature/heartbeat-complete`
- **Day 3-4:** Full integration testing (unit, visual, performance)
- **Day 5:** Prepare production deployment plan

### Week 7: Production Rollout
- **Day 1:** Deploy to 10% of users (canary)
- **Day 2:** Monitor metrics, increase to 50%
- **Day 3:** Full rollout to 100%
- **Day 4-5:** Monitor for issues, hotfix if needed

---

## MONITORING & OBSERVABILITY

### New Telemetry Points

**Initialization Metrics:**
```typescript
telemetry.track('canvas.init.started', { timestamp });
telemetry.track('canvas.init.completed', { duration, objectCount });
telemetry.track('canvas.init.failed', { error, phase });
```

**Sync Metrics:**
```typescript
telemetry.track('canvas.sync.triggered', { reason, objectCount });
telemetry.track('canvas.sync.divergence_detected', { storeCount, canvasCount });
telemetry.track('canvas.sync.lock_acquired', { reason });
telemetry.track('canvas.sync.lock_released', { duration });
```

**Performance Metrics:**
```typescript
telemetry.track('canvas.raf.scheduled', { taskCount });
telemetry.track('canvas.raf.executed', { duration, tasksExecuted });
telemetry.track('canvas.forceRerender.triggered', { attempt, reason });
telemetry.track('canvas.circuitBreaker.tripped', { attempts });
```

### Error Tracking

**Critical Errors:**
- Infinite loop detected (circuit breaker)
- Canvas sync divergence > 10 objects
- Disposal called on already-disposed canvas
- Sync lock not released after 5 seconds

**Warnings:**
- Force rerender triggered (attempt 2+)
- Viewport recovery disabled
- Unit scale stale during operation
- Guide z-order conflict detected

### Alerts

**Slack/PagerDuty:**
- Circuit breaker trips > 10x/hour → Alert on-call engineer
- Canvas sync divergence > 5% of sessions → Review logs
- Memory leak detected (heap growth) → Investigate

**Dashboard (Grafana):**
- Canvas initialization success rate (target: >99.9%)
- Average sync lock duration (target: <50ms)
- Force rerender rate (target: <0.1% of sessions)
- RAF queue depth histogram (target: <5 tasks)

---

## RISK MITIGATION

### High-Risk Items

**Risk 1: Performance Regression**
- **Likelihood:** Medium
- **Impact:** High
- **Mitigation:** Run performance benchmarks after each phase. If >20% slowdown, roll back.

**Risk 2: Breaking Existing Projects**
- **Likelihood:** Medium
- **Impact:** Critical
- **Mitigation:** Test loading 100 real user projects (anonymized) before production.

**Risk 3: State Migration Issues**
- **Likelihood:** Low
- **Impact:** High
- **Mitigation:** Implement backward-compatible state format. Old projects work without migration.

### Feature Flags

Enable gradual rollout:
```typescript
const featureFlags = {
  heartbeat_phase1_atomic_init: true,
  heartbeat_phase2_zustand_primary: false,  // Off until tested
  heartbeat_phase3_unified_raf: false,
  heartbeat_phase4_coordinate_system: false,
};
```

Toggle via admin panel or environment variable.

---

## SUCCESS CRITERIA - FINAL

### Functional Requirements
- ✅ Zero divergence between Zustand and Fabric (100% of sessions)
- ✅ No infinite loops (0 circuit breaker trips in production)
- ✅ Clean initialization (canary errors drop to <0.01%)
- ✅ Deterministic guide rendering (100% of visual regression tests pass)

### Performance Requirements
- ✅ Canvas init time: < 500ms (95th percentile)
- ✅ Sync operation: < 16ms (60 FPS maintained)
- ✅ 1000 object load: < 2 seconds
- ✅ Memory stable (no leaks over 10 min session)

### Reliability Requirements
- ✅ Crash rate: < 0.1% (down from current 0.5%)
- ✅ State persistence: 100% (no lost work)
- ✅ Cross-browser compatibility: Chrome, Firefox, Safari, Edge

---

## APPENDIX A: FILE CHANGE SUMMARY

### New Files Created (7)
1. `src/editor/utils/frameScheduler.ts` - Unified RAF cycle
2. `src/editor/utils/coordinateSystem.ts` - Centralized coordinate management
3. `src/editor/fabric/guideRegistry.ts` - Guide object tracking
4. `src/editor/fabric/zIndexManifest.ts` - Z-index layer definitions
5. `src/editor/hooks/useCanvasLifecycle.ts` - Atomic init hook
6. `src/editor/utils/telemetry.ts` - Metrics tracking
7. `__tests__/integration/canvasSync.test.tsx` - Integration tests

### Files Modified (12)
1. `src/editor/components/CanvasStage.tsx` - Major refactor (all phases)
2. `src/editor/state/editorStore.ts` - Add `canvasObjects`, sync lock, ready state
3. `src/editor/fabric/canvasUtils.ts` - Use guide registry, z-index
4. `src/editor/fabric/smartGuides.ts` - Use guide registry, shared RAF
5. `src/editor/fabric/themeUtils.ts` - Add readiness check
6. `src/editor/fabric/objectFactories.ts` - Return serialized objects
7. `src/editor/utils/serialization.ts` - Expand utilities
8. `src/editor/utils/units.ts` - Add validation proxy
9. `src/editor/components/StatusBar.tsx` - Add viewport status
10. `src/editor/components/EditorShell.tsx` - Error modal for circuit breaker
11. `src/editor/types/canvas.ts` - Add new type definitions
12. `package.json` - Add testing dependencies if needed

### Lines of Code Estimate
- **Added:** ~2,500 lines (new classes, tests, hooks)
- **Modified:** ~1,800 lines (refactored logic)
- **Removed:** ~400 lines (dead code, simplified logic)
- **Net Change:** +3,900 lines

---

## APPENDIX B: GLOSSARY

**Terms:**

- **Atomic Initialization:** Init sequence that cannot be interrupted mid-execution
- **Cancellation Token:** Signal (AbortController) to stop async operations
- **Circuit Breaker:** Pattern to prevent infinite loops by limiting retries
- **Frame Scheduler:** Unified RAF queue to batch updates per frame
- **Guide Registry:** Central authority for identifying guide objects
- **Primary Source of Truth:** Authoritative data store (Zustand)
- **RAF:** requestAnimationFrame - browser API for smooth animations
- **Render Delegate:** Fabric.js canvas acting as rendering layer only
- **Sync Lock:** Mechanism to prevent concurrent sync operations
- **Unidirectional Flow:** Data flows one direction (Store → Canvas)
- **Z-Index Manifest:** Defined layer ordering for canvas objects

---

## APPENDIX C: CONTACT & ESCALATION

**Code Owners:**
- Initialization: [Phase 1 Lead]
- State Management: [Phase 2 Lead]
- Rendering: [Phase 3 Lead]
- Coordinates: [Phase 4 Lead]

**Escalation Path:**
1. Issue detected → Check runbook
2. Not resolved → Ping #design-space-eng Slack channel
3. Critical issue → Page on-call engineer
4. Production down → Escalate to CTO

**Post-Mortem:**
If circuit breaker trips in production, file incident report within 24 hours.

---

## DOCUMENT CHANGELOG

- **v1.0 (2026-01-09):** Initial roadmap created from forensic audit
- **v1.1 (TBD):** Updated after Phase 1 completion
- **v2.0 (TBD):** Final version after all phases complete

---

**END OF ROADMAP**

This document is a living artifact. Update it as implementation progresses, discoveries are made, and priorities shift. The goal is not perfection—it's a stable heartbeat that keeps Design Space alive.
