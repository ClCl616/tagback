import React from 'react';
import ReactDOM from 'react-dom/client';
import KioskEntry from './kiosk/KioskEntry';
import { requireInstalledHost } from './kiosk-host/runtime';
import './styles.css';
import './kiosk/installed.css';

// The native preload must install its bridge before this module executes.
requireInstalledHost();
document.documentElement.classList.add('kiosk-installed');
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <KioskEntry />
  </React.StrictMode>,
);
