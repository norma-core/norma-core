// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import BaseRobotRenderer from './BaseRobotRenderer';

const mocks = vi.hoisted(() => ({
  completeUrdfLoad: null as null | ((robot: MockRobot) => void),
}));

interface MockJoint {
  limit: { lower: number; upper: number };
  setJointValue: ReturnType<typeof vi.fn>;
}

interface MockRobot {
  joints: Record<string, MockJoint>;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  traverse: (callback: (child: unknown) => void) => void;
}

vi.mock('urdf-loader', () => ({
  default: class MockUrdfLoader {
    loadMeshCb: unknown;

    load(
      _path: string,
      onLoad: (robot: MockRobot) => void,
    ) {
      mocks.completeUrdfLoad = onLoad;
    }
  },
}));

vi.mock('three/examples/jsm/loaders/STLLoader.js', () => ({
  STLLoader: class MockStlLoader {},
}));

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class MockOrbitControls {
    enableDamping = false;
    dampingFactor = 0;
    screenSpacePanning = false;
    minDistance = 0;
    maxDistance = 0;
    update() {}
    dispose() {}
  },
}));

vi.mock('three', () => {
  class MockObject3D {
    geometry?: { dispose: () => void };
    material?: unknown;
    traverse() {}
  }

  class MockScene extends MockObject3D {
    background: unknown;
    add() {}
    remove() {}
    clear() {}
  }

  class MockPerspectiveCamera {
    aspect = 1;
    position = { set() {} };
    lookAt() {}
    updateProjectionMatrix() {}
  }

  class MockWebGlRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false };
    renderLists = { dispose() {} };
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
    forceContextLoss() {}
  }

  return {
    Object3D: MockObject3D,
    Scene: MockScene,
    PerspectiveCamera: MockPerspectiveCamera,
    WebGLRenderer: MockWebGlRenderer,
    AmbientLight: class MockAmbientLight extends MockObject3D {},
    DirectionalLight: class MockDirectionalLight extends MockObject3D {
      position = { set() {} };
      castShadow = false;
    },
    AxesHelper: class MockAxesHelper extends MockObject3D {},
    GridHelper: class MockGridHelper extends MockObject3D {},
    LoadingManager: class MockLoadingManager {},
    BufferGeometry: class MockBufferGeometry {},
    Material: class MockMaterial {},
    Texture: class MockTexture {},
    MeshPhongMaterial: class MockMeshPhongMaterial {},
    Mesh: class MockMesh extends MockObject3D {},
  };
});

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

vi.mock('@/utils/asset-hashes', () => ({
  appendHash: (path: string) => path,
}));

vi.mock('@/utils/theme-colors', () => ({
  getRendererThemeColors: () => ({
    gridPrimary: 0,
    gridSecondary: 0,
    sceneBackground: 0,
  }),
}));

vi.mock('../utils', () => ({
  mat4FromRotationTranslation: () => [],
  parseUrdf: () => ({}),
  rpyToMatrix: () => [],
}));

let root: Root | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  mocks.completeUrdfLoad = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('uses the full servo range while calibration bounds are collapsed', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class MockResizeObserver {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => '<robot />' })));

  const data = new Uint8Array(0x47);
  data[0x38] = 0x00;
  data[0x39] = 0x08;
  const setJointValue = vi.fn();
  const robot: MockRobot = {
    joints: {
      '1': {
        limit: { lower: -1, upper: 1 },
        setJointValue,
      },
    },
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    traverse: () => undefined,
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(createElement(BaseRobotRenderer, {
      busSerialNumber: 'arm-1',
      bus: {
        motors: [{
          id: 1,
          state: data,
          rangeMin: 2048,
          rangeMax: 2048,
        }],
      },
      urdfPath: '/arm.urdf',
      jointNames: ['1'],
    }));
  });

  expect(mocks.completeUrdfLoad).not.toBeNull();
  await act(async () => mocks.completeUrdfLoad?.(robot));

  expect(setJointValue).toHaveBeenLastCalledWith(expect.closeTo(1 / 4095, 5));
});
