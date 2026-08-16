import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fabric from 'fabric';
import {
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import {
  CommittedColorInput,
  CommittedInput,
  ControlSlider,
} from '../src/editor/components/Tooltip';
import {
  createProjectChangeCoordinator,
} from '../src/editor/session/projectChangeCoordinator';
import {
  createProjectChangeDiagnosticObserver,
  PROJECT_CHANGE_DIAGNOSTIC_COVERAGE,
} from '../src/editor/session/projectChangeDiagnostic';
import {
  readCanvasStyleValue,
} from '../src/editor/services/canvasMutationObservation';
import { useEditorStore } from '../src/editor/state/editorStore';
import { useHistoryStore } from '../src/editor/state/useHistoryStore';

const originalEditorState = useEditorStore.getState();
const originalHistoryState = useHistoryStore.getState();
const canvases: Array<{ canvas: fabric.Canvas; element: HTMLCanvasElement }> = [];

afterEach(() => {
  cleanup();
  canvases.splice(0).forEach(({ canvas, element }) => {
    canvas.dispose();
    element.remove();
  });
  useEditorStore.setState(originalEditorState, true);
  useHistoryStore.setState(originalHistoryState, true);
  vi.restoreAllMocks();
});

describe('Unified Editor authored-boundary closure', () => {
  it('uses native color input/change as one commit boundary without blur inference', () => {
    const onCommit = vi.fn();
    const onInput = vi.fn();
    const Harness = () => {
      const [value, setValue] = React.useState('#112233');
      return React.createElement(CommittedColorInput, {
        'aria-label': 'Closure color',
        value,
        onInput: (next: string) => {
          onInput(next);
          setValue(next);
        },
        onCommit,
      });
    };

    render(React.createElement(Harness));
    const input = screen.getByLabelText('Closure color');

    fireEvent.pointerDown(input);
    fireEvent.blur(input);
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerDown(input);
    fireEvent.input(input, { target: { value: '#445566' } });
    expect(onInput).toHaveBeenCalledWith('#445566');
    fireEvent.change(input, { target: { value: '#445566' } });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#445566', '#112233');
  });

  it('commits one numeric interaction on Enter or blur and suppresses effective no-ops', () => {
    const commits: Array<[string, string]> = [];
    const Harness = () => {
      const [value, setValue] = React.useState('12');
      return React.createElement(CommittedInput, {
        'aria-label': 'Closure numeric',
        type: 'number',
        value,
        onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
          setValue(event.target.value);
        },
        onCommit: (next: string, initial: string) => commits.push([next, initial]),
      });
    };

    render(React.createElement(Harness));
    const input = screen.getByLabelText('Closure numeric');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.blur(input);
    expect(commits).toEqual([['18', '12']]);

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '18' } });
    fireEvent.blur(input);
    expect(commits).toEqual([['18', '12']]);
  });

  it('uses the established slider lifecycle for changed and unchanged interactions', () => {
    const commits: Array<[number, number]> = [];
    render(React.createElement(ControlSlider, {
      'aria-label': 'Closure slider',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.5,
      onChange: vi.fn(),
      onCommit: (next: number, initial: number) => commits.push([next, initial]),
    }));
    const slider = screen.getByRole('slider');

    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '0.5' } });
    fireEvent.pointerUp(slider, { target: { value: '0.5' } });
    expect(commits).toEqual([]);

    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.change(slider, { target: { value: '0.65' } });
    fireEvent.keyUp(slider, { key: 'ArrowRight', target: { value: '0.65' } });
    expect(commits).toEqual([[0.65, 0.5]]);
  });

  it('reports a style preset as one product intent instead of property-level facts', () => {
    const element = document.createElement('canvas');
    element.width = 320;
    element.height = 240;
    document.body.appendChild(element);
    const canvas = new fabric.Canvas(element, {
      width: 320,
      height: 240,
      renderOnAddRemove: false,
    });
    canvases.push({ canvas, element });
    const observer = vi.fn();
    useEditorStore.setState({
      canvas,
      canvasReadyState: 'ready',
      canvasObjects: [],
      committedMutationObserver: observer,
      isHydrating: false,
    } as any);
    const text = new fabric.IText('Preset', {
      id: 'preset-text',
      fill: '#111111',
    });
    canvas.add(text);
    useEditorStore.getState().syncCanvasToStore(canvas);
    const before = readCanvasStyleValue(text, 'style-preset');
    text.set({ fill: 'transparent', stroke: '#ffffff', strokeWidth: 2 });
    useEditorStore.getState().syncCanvasToStore(canvas);
    useEditorStore.getState().reportCommittedCanvasStyle(
      'preset-text',
      'style-preset',
      before,
    );

    expect(observer).toHaveBeenCalledTimes(1);
    expect(observer).toHaveBeenCalledWith({
      action: 'apply-freeform-style-preset',
      objectId: 'preset-text',
      style: 'style-preset',
    });
  });

  it('keeps the final coverage contract narrow while complete authored coverage is true', () => {
    expect(PROJECT_CHANGE_DIAGNOSTIC_COVERAGE).toMatchObject({
      canvasCommittedColorControls: true,
      canvasNumericControls: true,
      canvasPresetResetCommands: true,
      canvasThemeOperations: true,
      canvasMultiTargetOperations: true,
      canvasSelectionLock: true,
      documentMetadata: true,
      documentImageMetadata: true,
      documentImageLayout: true,
      documentImageGroups: true,
      documentReferences: true,
      completeAuthoredCoverage: true,
    });
    expect(PROJECT_CHANGE_DIAGNOSTIC_COVERAGE.unobservedAuthoredChangeCategories)
      .toEqual(expect.arrayContaining([
        'Canvas editor chrome, viewport, guides, snap/grid settings, and selection state',
        'Document selection, zoom, fit mode, and inspector focus state',
        'Hydration, replay, recovery bookkeeping, autosave, navigation persistence, and teardown',
      ]));
  });

  it('can observe project-level authored intent without engine payload leakage', () => {
    const coordinator = createProjectChangeCoordinator();
    const diagnostic = createProjectChangeDiagnosticObserver({ coordinator });
    diagnostic.observeSession({
      projectId: 'closure-project',
      legacyDirty: false,
      legacySaveStatus: 'saved',
    });

    coordinator.observeCommitted({
      projectId: 'closure-project',
      source: 'canvas',
      action: 'apply-freeform-theme',
      pageIds: ['page-1'],
      domains: ['style'],
      target: { kind: 'project', id: 'closure-project' },
      assetEffect: 'none',
    });

    expect(diagnostic.view.getSnapshot()).toMatchObject({
      observedRevision: 1,
      committedTransactionCount: 1,
      lastCommittedTransaction: {
        action: 'apply-freeform-theme',
        target: { kind: 'project', id: 'closure-project' },
        domains: ['style'],
        assetEffect: 'none',
      },
    });
    diagnostic.dispose();
    coordinator.dispose();
  });
});
