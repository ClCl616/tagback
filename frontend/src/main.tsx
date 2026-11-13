import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import MobileApp from './mobile/MobileApp';
import KioskEntry from './kiosk/KioskEntry';
import AdminApp from './admin/AdminApp';
import './web-fonts.css';
import './styles.css';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/mobile/*" element={<MobileApp />} />
        <Route path="/kiosk/*" element={<KioskEntry />} />
        <Route path="/admin/*" element={<AdminApp />} />
        <Route path="*" element={<Navigate to="/mobile" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
