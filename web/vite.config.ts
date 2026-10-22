/** @file 本地与 GitHub Pages 使用同一份源码；资源前缀由部署命令配置，不写死在组件中。 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || '/',
  test: { environment: 'node', testTimeout: 30000, hookTimeout: 30000 }
})
