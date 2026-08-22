import React from 'react';
import { Outlet } from 'react-router-dom';
import Navigation from './Navigation';

const MainLayout: React.FC = () => {
  return (
    <div className="flex min-h-screen w-full flex-col bg-surface-base text-text-primary">
      <Navigation />
      <Outlet />
    </div>
  );
};

export default MainLayout;
