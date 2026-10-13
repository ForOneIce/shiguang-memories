import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  server: {
    host: '127.0.0.1',
    fs: {
      strict: true,
      allow: [projectRoot],
      deny: [
        '.env', '.env.*', '**/.git/**', '**/.aws/**', '**/*.{crt,pem,key,p12}',
        '**/private/**', '**/imports/**', '**/backups/**', '**/docs/**', '**/tests/**',
        '**/screenshots/**', '**/artifacts/**', '**/output/**', '**/work/**', '**/.tmp/**',
        '**/conversations*.json', '**/shiguang-backup*.json',
        '**/shiguang-conversations*.json', '**/*.{zip,7z,rar,tar,tgz,gz}',
      ],
    },
  },
  build: { sourcemap: false },
});
