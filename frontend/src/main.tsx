import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import MobileApp from './mobile/MobileApp';
import KioskApp from './kiosk/KioskApp';
import Simulator from './dev/Simulator';
import AdminApp from './admin/AdminApp';
import { HTTP_AUTH } from './shared/authMode';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/mobile/*" element={<MobileApp />} />
        <Route path="/kiosk/*" element={<KioskApp />} />
        {(import.meta.env.DEV || HTTP_AUTH) && <>
          <Route path="/admin" element={<AdminApp />} />
          <Route path="/admin/items" element={<AdminApp />} />
        </>}
        {import.meta.env.DEV && <Route path="/dev/simulator" element={<Simulator />} />}
        <Route path="*" element={<Navigate to="/mobile" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
