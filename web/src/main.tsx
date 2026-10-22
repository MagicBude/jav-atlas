/** @file 浏览端入口：一个数据路由、一份应用上下文；采集脚本不属于浏览器运行时。 */
import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router-dom'
import App from './app/App'
import { AppProvider } from './app/context'
import './shared/styles.css'
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <main className="empty-state">
        <h1>页面发生异常</h1>
        <p>已保存的本地数据不会因此被清空。</p>
        <button onClick={() => window.location.reload()}>刷新重试</button>
      </main>
    ) : (
      this.props.children
    )
  }
}
const router = createHashRouter([{ path: '*', element: <App /> }])
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ErrorBoundary>
  </StrictMode>
)
