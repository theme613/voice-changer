/**
 * main.tsx — React Entry Point
 *
 * Renders the App component into the root DOM element.
 * Imports the global design system styles.
 */

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
