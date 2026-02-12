import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function NetworkStatusIndicator() {
  const { isOnline, isSlowConnection, effectiveType } = useNetworkStatus();

  if (isOnline && !isSlowConnection) {
    return null; // Don't show anything when everything is fine
  }

  return (
    <div className={`fixed top-4 right-4 z-50 p-3 rounded-lg shadow-lg ${
      isOnline ? 'bg-yellow-100 border border-yellow-300' : 'bg-red-100 border border-red-300'
    }`}>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${
          isOnline ? 'bg-yellow-500' : 'bg-red-500'
        }`} />
        
        <div className="text-sm">
          {!isOnline && (
            <span className="font-medium text-red-700">Offline Mode</span>
          )}
          
          {isOnline && isSlowConnection && (
            <span className="font-medium text-yellow-700">
              Slow Connection ({effectiveType})
            </span>
          )}
        </div>
      </div>
      
      <div className="text-xs mt-1 text-gray-600">
        {!isOnline && 'Changes will sync when connection is restored'}
        {isOnline && isSlowConnection && 'Some features may be limited'}
      </div>
    </div>
  );
}