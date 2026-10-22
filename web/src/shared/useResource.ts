/** @file 通用异步读取状态；键变更后旧响应不能覆盖新页面，不向 localStorage 写请求缓存。 */
import { useEffect, useState } from 'react'
export function useResource<T>(key: string, load: () => Promise<T>) {
  const [revision, retry] = useState(0)
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key: '' })
  useEffect(() => {
    if (!key) return
    let alive = true
    load()
      .then(value => {
        if (alive) setState({ key, value })
      })
      .catch(error => {
        if (alive) setState({ key, error: String(error.message || error) })
      })
    return () => {
      alive = false
    }
    // load 是当前 render 的读取闭包，真正的资源身份由 key 唯一确定。
  }, [key, revision])
  return {
    value: state.key === key ? state.value : undefined,
    error: state.key === key ? state.error : undefined,
    retry: () => {
      setState({ key: '' })
      retry(value => value + 1)
    }
  }
}
