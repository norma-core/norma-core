import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import viteCompression from 'vite-plugin-compression';

const workspaceCargoTomlPath = path.resolve(__dirname, '../../../../Cargo.toml');

function resolveWorkspaceVersion(): string {
  try {
    const cargoToml = readFileSync(workspaceCargoTomlPath, 'utf8');
    const lines = cargoToml.split(/\r?\n/);
    let inWorkspacePackage = false;

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        continue;
      }

      if (trimmedLine.startsWith('[') && trimmedLine.endsWith(']')) {
        inWorkspacePackage = trimmedLine === '[workspace.package]';
        continue;
      }

      if (!inWorkspacePackage) {
        continue;
      }

      const versionMatch = trimmedLine.match(/^version\s*=\s*"([^"]+)"/);
      if (versionMatch) {
        return versionMatch[1];
      }
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function resolveGitHash(): string {
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'unknown';
  }
}

const stationVersion = `${resolveWorkspaceVersion()} (${resolveGitHash()})`;

// https://vite.dev/config/
export default defineConfig({
  // Required for loading the built viewer from Electron via file://.
  base: './',
  define: {
    __STATION_VERSION__: JSON.stringify(stationVersion),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  assetsInclude: ['**/*.urdf', '**/*.stl'],
  esbuild: {
    supported: {
      'top-level-await': true, // browsers can handle top-level-await features
    },
  },
  server: {
    host: '::',
    allowedHosts: ['localhost', 'ds-pc.server'],
    port: 5173,
    proxy: {
      '/api': {
        target: 'ws://localhost:8889',
        changeOrigin: false,
        ws: true,
      },
    },
  },
  plugins: [
    viteCompression({
      algorithm: 'gzip',
      ext: '.gz',
      threshold: 1024,
      filter: /\.(js|mjs|json|css|html|urdf|stl)$/i,
    }),
    react(),
    tailwindcss(),
  ],
});
