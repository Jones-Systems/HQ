import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

function ShellHealth() {
  useEffect(() => {
    void window.hqUpdates?.shellReady().catch(() => {
      console.error('HQ startup acknowledgement could not be recorded.');
    });
  }, []);
  return null;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /><ShellHealth /></StrictMode>);
