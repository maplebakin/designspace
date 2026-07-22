
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

const start = async () => {
  await prepareStartupStorage()
  const { default: App } = await import('./App.tsx')
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
