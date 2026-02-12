import { useEffect, useState } from 'react';

interface NetworkStatus {
  isOnline: boolean;
  isSlowConnection: boolean;
  connectionType?: string;
  effectiveType?: string;
}

export function useNetworkStatus(): NetworkStatus {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>({
    isOnline: navigator.onLine,
    isSlowConnection: false,
    connectionType: 'unknown',
    effectiveType: 'unknown'
  });

  useEffect(() => {
    const updateNetworkStatus = () => {
      const connection = (navigator as any).connection || 
                         (navigator as any).mozConnection || 
                         (navigator as any).webkitConnection;

      const isSlowConnection = connection 
        ? (connection.effectiveType === 'slow-2g' || 
           connection.effectiveType === '2g' || 
           connection.downlink < 0.5)
        : false;

      setNetworkStatus({
        isOnline: navigator.onLine,
        isSlowConnection,
        connectionType: connection?.type || 'unknown',
        effectiveType: connection?.effectiveType || 'unknown'
      });
    };

    // Initial status
    updateNetworkStatus();

    // Listen for online/offline events
    const handleOnline = () => updateNetworkStatus();
    const handleOffline = () => updateNetworkStatus();

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Listen for connection changes if available
    const connection = (navigator as any).connection || 
                       (navigator as any).mozConnection || 
                       (navigator as any).webkitConnection;
    
    if (connection) {
      connection.addEventListener('change', updateNetworkStatus);
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      
      if (connection) {
        connection.removeEventListener('change', updateNetworkStatus);
      }
    };
  }, []);

  return networkStatus;
}

export function useOfflineQueue<T>() {
  const [queue, setQueue] = useState<T[]>([]);

  const addToQueue = (item: T) => {
    setQueue(prev => [...prev, item]);
  };

  const clearQueue = () => {
    setQueue([]);
  };

  const processQueue = async (processor: (item: T) => Promise<void>) => {
    const itemsToProcess = [...queue];
    setQueue([]);

    for (const item of itemsToProcess) {
      try {
        await processor(item);
      } catch (error) {
        console.error('Failed to process queued item:', error);
        // Re-add to queue if processing fails
        setQueue(prev => [...prev, item]);
        break;
      }
    }
  };

  return { queue, addToQueue, clearQueue, processQueue };
}