import { describe, expect, it } from 'vitest';
import {
  assertInteractionMode,
  createCanvasEditingMode,
  createDocumentIdleMode,
  createModalInteractionMode,
  createOverlayManipulationMode,
  createPhotoManipulationMode,
  createReferenceAdjustmentMode,
  createTextEditingMode,
  interactionModeAllowsShortcut,
  interactionModeOwnsPointerInput,
  transitionInteractionMode,
} from '../src/editor/session/interactionMode';

describe('interaction mode contract', () => {
  it('declares pointer, keyboard, selection, and Escape ownership per mode', () => {
    const canvas = createCanvasEditingMode('session-1', 'page-1', 'draw');
    const text = createTextEditingMode('session-1', 'page-1', 'body');
    const reference = createReferenceAdjustmentMode('session-1', 'page-1', 'asset-1');

    expect(canvas).toMatchObject({
      kind: 'canvas-editing',
      surface: 'canvas',
      selectionAuthority: 'fabric',
      escape: 'clear-canvas-selection',
    });
    expect(text).toMatchObject({
      kind: 'text-editing',
      surface: 'prosemirror',
      keyboardScope: 'text',
      escape: 'blur-text',
    });
    expect(interactionModeOwnsPointerInput(reference, 'scan-reference')).toBe(true);
    expect(interactionModeAllowsShortcut(text, 'text')).toBe(true);
    expect(interactionModeAllowsShortcut(text, 'canvas')).toBe(false);
  });

  it('rejects modes belonging to a stale session or page', () => {
    const current = createDocumentIdleMode('session-1', 'page-1');
    const staleSession = createOverlayManipulationMode('session-2', 'page-1', 'overlay-1');
    const stalePage = createTextEditingMode('session-1', 'page-2', 'body');

    expect(transitionInteractionMode(current, staleSession, {
      sessionIdentity: 'session-1',
      activePageId: 'page-1',
    })).toMatchObject({ accepted: false });
    expect(transitionInteractionMode(current, stalePage, {
      sessionIdentity: 'session-1',
      activePageId: 'page-1',
    })).toMatchObject({ accepted: false });
    expect(transitionInteractionMode(current, createTextEditingMode('session-1', 'page-1', 'title'), {
      sessionIdentity: 'session-1',
      activePageId: 'page-1',
    })).toMatchObject({ accepted: true });
    expect(transitionInteractionMode(current, createTextEditingMode('session-1', 'page-1', 'title'), {
      sessionIdentity: 'session-1',
      activePageId: null,
    })).toMatchObject({ accepted: false });
  });

  it('validates required selection identities and allows modal return metadata', () => {
    expect(() => assertInteractionMode(createPhotoManipulationMode('session-1', 'page-1', {
      imageIds: ['image-1'],
      primaryImageId: 'missing-image',
    }))).toThrow(/selected image set/i);
    const modal = createModalInteractionMode('session-1', null, 'save-dialog', 'document-idle');
    expect(assertInteractionMode(modal)).toMatchObject({
      kind: 'modal',
      dialogId: 'save-dialog',
      returnKind: 'document-idle',
      escape: 'close-modal',
    });
    expect(() => assertInteractionMode({
      ...modal,
      surface: 'canvas',
    })).toThrow(/ownership metadata/i);
  });
});
