import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import MobileApp from './mobile/MobileApp';
import KioskApp from './kiosk/KioskApp';
import Simulator from './dev/Simulator';
import AdminApp from './admin/AdminApp';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/mobile/*" element={<MobileApp />} />
        <Route path="/kiosk/*" element={<KioskApp />} />
        {import.meta.env.DEV && <Route path="/admin/*" element={<AdminApp />} />}
        {import.meta.env.DEV && <Route path="/dev/simulator" element={<Simulator />} />}
        <Route path="*" element={<Navigate to="/mobile" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
