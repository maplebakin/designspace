import React, { useLayoutEffect } from 'react';
import { applyUiCssVars, useUiThemeStore } from '../state/uiThemeStore';

export const UIThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const vars = useUiThemeStore((state) => state.vars);

  useLayoutEffect(() => {
    applyUiCssVars(vars);
  }, [vars]);

  return <>{children}</>;
};
