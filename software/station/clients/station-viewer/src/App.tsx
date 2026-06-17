import { lazy, Suspense } from 'react';
import { BrowserRouter, HashRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import { isElectron } from '@/utils/platform';

// Use HashRouter for Electron (file:// protocol) — BrowserRouter for web
const Router = isElectron() ? HashRouter : BrowserRouter;

const HomePage = lazy(() => import('./pages/HomePage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const St3215MotorConfigPage = lazy(() => import('./pages/St3215MotorConfigPage'));
const St3215BusCalibrationPage = lazy(() => import('./pages/St3215BusCalibrationPage'));

function App() {
  return (
    <Router>
      <Suspense fallback={<div className="min-h-screen bg-surface-base flex items-center justify-center text-accent-data font-mono">Loading...</div>}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/history" element={<HistoryPage />} />
          </Route>
          <Route path="/st3215-bus-calibration" element={<St3215BusCalibrationPage />} />
          <Route path="/st3215-bind-motors" element={<St3215MotorConfigPage />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
