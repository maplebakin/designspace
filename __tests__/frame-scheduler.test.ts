import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameScheduler, TaskPriority } from '../src/editor/utils/frameScheduler';

describe('FrameScheduler stability', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defers work scheduled by a callback until the next frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const scheduler = new FrameScheduler();
    const calls: string[] = [];
    scheduler.scheduleTask(() => {
      calls.push('first');
      scheduler.scheduleTask(() => calls.push('second'), TaskPriority.High);
    }, TaskPriority.High);

    expect(frames).toHaveLength(1);
    frames.shift()?.(0);
    expect(calls).toEqual(['first']);
    expect(frames).toHaveLength(1);

    frames.shift()?.(16);
    expect(calls).toEqual(['first', 'second']);
    expect(scheduler.getTaskCount()).toBe(0);
  });
});
