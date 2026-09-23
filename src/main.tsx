
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { prepareStartupStorage } from './editor/persistence/startupStorageRecovery.ts'


if (typeof window !== 'undefined' && window.location.hostname === 'localhost' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => {
      void registration.unregister();
    });
  });
}

const rootElement = document.getElementById('root')!
const root = ReactDOM.createRoot(rootElement)

const loadAppModule = async (retries: number): Promise<typeof import('./App.tsx')> => {
  try {
    return await import('./App.tsx')
  } catch (error) {
    if (retries <= 0) throw error
    // Repeated reloads can exhaust Chromium's resources, rejecting the dynamic
    // import with net::ERR_INSUFFICIENT_RESOURCES. Pause briefly and retry once
    // before giving up.
    await new Promise((resolve) => setTimeout(resolve, 500))
    return loadAppModule(retries - 1)
  }
}

const start = async () => {
  await prepareStartupStorage()
  const { default: App } = await loadAppModule(1)
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

void start().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error'
  rootElement.textContent = `Design Space could not start: ${message}`
})
