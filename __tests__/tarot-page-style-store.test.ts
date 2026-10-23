import { afterEach, describe, expect, it } from 'vitest';
import { useTarotPageStyleStore } from '../src/editor/state/tarotPageStyleStore';
import { DEFAULT_TAROT_PAGE_STYLE } from '../src/editor/tarot/pageStyle';

describe('tarot page style vault', () => {
  const original = useTarotPageStyleStore.getState().savedStyles;

  afterEach(() => {
    useTarotPageStyleStore.setState({ savedStyles: original });
  });

  it('saves, renames, and deletes a reusable style without changing starters', () => {
    const id = useTarotPageStyleStore.getState().saveStyle('Evening study', DEFAULT_TAROT_PAGE_STYLE);
    expect(id).toBeTruthy();
    expect(useTarotPageStyleStore.getState().savedStyles.some((entry) => entry.id === id && entry.name === 'Evening study')).toBe(true);

    useTarotPageStyleStore.getState().renameStyle(id!, 'Renamed study');
    expect(useTarotPageStyleStore.getState().savedStyles.find((entry) => entry.id === id)?.name).toBe('Renamed study');
    useTarotPageStyleStore.getState().deleteStyle(id!);
    expect(useTarotPageStyleStore.getState().savedStyles.some((entry) => entry.id === id)).toBe(false);

    const starter = useTarotPageStyleStore.getState().savedStyles.find((entry) => entry.starter);
    expect(starter).toBeTruthy();
    useTarotPageStyleStore.getState().deleteStyle(starter!.id);
    expect(useTarotPageStyleStore.getState().savedStyles.some((entry) => entry.id === starter!.id)).toBe(true);
  });
});
