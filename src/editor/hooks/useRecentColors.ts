import { useThemeStore } from '../state/useThemeStore';

export const useRecentColors = () => {
  const recentColors = useThemeStore((state) => state.recentColors);
  const addColor = useThemeStore((state) => state.addRecentColor);
  const clearColors = useThemeStore((state) => state.clearRecentColors);

  return {
    recentColors,
    addColor,
    clearColors
  };
};
