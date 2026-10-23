import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // NAS의 어느 폴더에 올려도 동작하도록 모든 경로를 상대 경로로 만든다
  base: './',
  worker: {
    format: 'es',
  },
  server: {
    fs: {
      // 프로젝트 루트의 backend/src/*.py, data/study_rules.json을 가져오기 위해 상위 폴더 접근 허용
      allow: ['..'],
    },
  },
})
