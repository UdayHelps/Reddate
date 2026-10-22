import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { engine } from './engine';

engine.start();
createRoot(document.getElementById('root')!).render(<App />);
if ('serviceWorker' in navigator && location.hostname !== 'localhost' && !location.hostname.endsWith('.localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
}
