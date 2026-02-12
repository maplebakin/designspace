import React, { Component, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  retryCount: number;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  maxRetries?: number;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeouts: number[] = [];

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    this.setState({
      error,
      errorInfo
    });

    // Log to console in development
    console.error('Error Boundary caught an error:', error, errorInfo);

    // Call custom error handler
    this.props.onError?.(error, errorInfo);

    // Send to error reporting service
    this.reportError(error, errorInfo);
  }

  private reportError = (_error: Error, _errorInfo: React.ErrorInfo) => {
    // Integrate with error reporting service like Sentry
    try {
      // Example: Sentry.captureException(error, { contexts: { react: errorInfo } });
      console.warn('Error reported to monitoring service');
    } catch (reportingError) {
      console.warn('Failed to report error:', reportingError);
    }
  };

  private handleRetry = () => {
    const { maxRetries = 3 } = this.props;
    const { retryCount } = this.state;

    if (retryCount < maxRetries) {
      this.setState({
        hasError: false,
        error: null,
        errorInfo: null,
        retryCount: retryCount + 1
      });

      // Clear any existing retry timeouts
      this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
      this.retryTimeouts = [];
    }
  };

  private handleHardReset = () => {
    // Clear all state and timeouts
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
    this.retryTimeouts = [];

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0
    });

    // Reload page if all retries failed
    if (this.state.retryCount >= (this.props.maxRetries || 3)) {
      window.location.reload();
    }
  };

  componentWillUnmount() {
    // Cleanup any pending timeouts
    this.retryTimeouts.forEach(timeout => clearTimeout(timeout));
  }

  render() {
    const { hasError, error, errorInfo, retryCount } = this.state;
    const { children, fallback, maxRetries = 3 } = this.props;

    if (hasError) {
      // Custom fallback provided
      if (fallback) {
        return fallback;
      }

      // Default error UI
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-lg max-w-md w-full p-6">
            <div className="text-center">
              <div className="mb-4">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto">
                  <svg
                    className="w-8 h-8 text-red-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
              </div>

              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Something went wrong
              </h2>
              
              <p className="text-gray-600 mb-6">
                The application encountered an unexpected error. We apologize for the inconvenience.
              </p>

              <div className="space-y-3">
                {retryCount < maxRetries && (
                  <button
                    onClick={this.handleRetry}
                    className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
                  >
                    Try Again {retryCount > 0 && `(${retryCount}/${maxRetries})`}
                  </button>
                )}

                {retryCount >= maxRetries && (
                  <div className="text-sm text-gray-500 mb-3">
                    Maximum retry attempts reached. Please try refreshing the page.
                  </div>
                )}

                <button
                  onClick={this.handleHardReset}
                  className="w-full bg-gray-200 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-300 transition-colors"
                >
                  {retryCount >= maxRetries ? 'Refresh Page' : 'Reset Application'}
                </button>
              </div>

              {true && error && (
                <details className="mt-6 text-left">
                  <summary className="text-sm font-mono text-gray-500 cursor-pointer">
                    Error Details (Development Only)
                  </summary>
                  <div className="mt-2 p-3 bg-gray-100 rounded text-xs font-mono text-gray-700 max-h-40 overflow-auto">
                    <div className="font-semibold mb-2">Error:</div>
                    <div className="mb-3">{error.toString()}</div>
                    
                    {errorInfo && (
                      <>
                        <div className="font-semibold mb-2">Component Stack:</div>
                        <div className="whitespace-pre-wrap">{errorInfo.componentStack}</div>
                      </>
                    )}
                  </div>
                </details>
              )}
            </div>
          </div>
        </div>
      );
    }

    return children;
  }
}