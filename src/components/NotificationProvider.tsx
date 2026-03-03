import React, { createContext, useContext, useMemo } from 'react';
import { useEditorStore } from '../editor/state/editorStore';

type NotificationContextValue = {
  notifySuccess: (message: string) => void;
  notifyError: (message: string) => void;
  notifyWarning: (message: string) => void;
  notifyInfo: (message: string) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const setToast = useEditorStore((state) => state.setToast);

  const value = useMemo<NotificationContextValue>(() => ({
    notifySuccess: (message) => setToast({ message, variant: 'success' }),
    notifyError: (message) => setToast({ message, variant: 'error' }),
    notifyWarning: (message) => setToast({ message, variant: 'warning' }),
    notifyInfo: (message) => setToast({ message, variant: 'info' }),
  }), [setToast]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within NotificationProvider');
  }
  return context;
};
