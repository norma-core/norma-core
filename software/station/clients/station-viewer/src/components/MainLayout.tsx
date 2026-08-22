import React, { useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import Navigation from './Navigation';

export interface MainLayoutOutletContext {
  setImmersive: (isImmersive: boolean) => void;
}

const MainLayout: React.FC = () => {
  const [isImmersive, setImmersive] = useState(false);
  const outletContext = useMemo<MainLayoutOutletContext>(() => ({ setImmersive }), []);

  return (
    <div
      data-immersive={isImmersive ? 'true' : undefined}
      className={`flex min-h-screen w-full flex-col bg-surface-base text-text-primary ${
        isImmersive
          ? '[@media(max-width:1023px)_and_(orientation:landscape)]:h-[100svh] [@media(max-width:1023px)_and_(orientation:landscape)]:min-h-0 [@media(max-width:1023px)_and_(orientation:landscape)]:overflow-hidden'
          : ''
      }`}
    >
      <div className={isImmersive ? '[@media(max-width:1023px)_and_(orientation:landscape)]:hidden' : undefined}>
        <Navigation />
      </div>
      <Outlet context={outletContext} />
    </div>
  );
};

export default MainLayout;
