import React from 'react';
import { HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { MedicineProvider } from './context/MedicineContext';
import AppRoutes from './routes/AppRoutes';
import ActiveAlarmOverlay from './components/common/ActiveAlarmOverlay';
import { Toaster } from 'sonner';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';

function AndroidNavigationHandler() {
  useAndroidBackButton();
  return null;
}

export default function App() {
  return (
    <HashRouter>
      <AndroidNavigationHandler />
      {/* Global Active Alarm Overlay: Survives logout, route changes, and unmounting */}
      <ActiveAlarmOverlay />
      <AuthProvider>
        <MedicineProvider>
          <AppRoutes />
          <Toaster 
            position="top-center" 
            richColors 
            toastOptions={{
              style: {
                borderRadius: '16px',
                fontSize: '13px',
                fontFamily: 'inherit'
              }
            }}
          />
        </MedicineProvider>
      </AuthProvider>
    </HashRouter>
  );
}
