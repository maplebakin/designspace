import { describe, expect, it } from 'vitest';
import {
  prepareVisionBoardItemsForPersistence,
  type VisionItem,
} from '../src/editor/state/visionBoardStore';

const position = { x: 0, y: 0, width: 100, height: 100 };

const image = (overrides: Partial<Extract<VisionItem, { type: 'image' }>> = {}): Extract<VisionItem, { type: 'image' }> => ({
  type: 'image',
  id: 'image-1',
  position,
  src: 'https://assets.example/image.png',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('Vision Board persistence contract', () => {
  it('keeps reconstructible image sources and removes session-only thumbnails', () => {
    const external = image({
      id: 'external',
      thumbnail: 'blob:thumbnail-session-only',
    });
    const persisted = prepareVisionBoardItemsForPersistence([external]);

    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      id: 'external',
      src: 'https://assets.example/image.png',
    });
    expect('thumbnail' in persisted[0]).toBe(false);
  });

  it('does not persist image items whose only source is a session blob URL', () => {
    const persisted = prepareVisionBoardItemsForPersistence([
      image({ id: 'session-image', src: 'blob:image-session-only' }),
      {
        type: 'color',
        id: 'color-1',
        position,
        hex: '#123456',
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    expect(persisted.map((item) => item.id)).toEqual(['color-1']);
  });

  it('does not mutate the live item while preparing the persisted projection', () => {
    const sessionThumbnail = 'blob:thumbnail-session-only';
    const item = image({ thumbnail: sessionThumbnail });

    prepareVisionBoardItemsForPersistence([item]);

    expect(item.thumbnail).toBe(sessionThumbnail);
  });
});
