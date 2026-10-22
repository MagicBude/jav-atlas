/**
 * @file 返回位置属于当前浏览会话，不是人物资料，也不会进入分享 URL。
 * 优先恢复人物锚点及其偏移，数字 scrollY 仅作为数据变化后的后备。
 */
import type { Location } from 'react-router-dom'
export interface ReturnPosition {
  url: string
  person?: string
  neighbors: string[]
  offset: number
  y: number
  at: number
}
const KEY = 'jav-atlas:return:v1'
const FILTERS_KEY = 'jav-atlas:private-filters:v1'
/** 个人筛选按历史项保存并限制数量，不在每次输入后留下无限增长的 sessionStorage 键。 */
export function readPrivateFilters(key: string) {
  try {
    return JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}')[key]?.value || null
  } catch {
    return null
  }
}
export function savePrivateFilters(key: string, value: unknown) {
  try {
    const records = JSON.parse(sessionStorage.getItem(FILTERS_KEY) || '{}')
    records[key] = { value, at: Date.now() }
    sessionStorage.setItem(
      FILTERS_KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(records)
            .sort((a, b) => (b[1] as { at: number }).at - (a[1] as { at: number }).at)
            .slice(0, 20)
        )
      )
    )
  } catch {
    /* 无可用会话存储时，仅降级筛选恢复；个人持久数据仍由独立仓库管理。 */
  }
}
export function rememberList(location: Location) {
  const nodes = [...document.querySelectorAll<HTMLElement>('[data-person]')]
  const position = nodes.findIndex(node => node.getBoundingClientRect().bottom > 80),
    visible = nodes[position]
  const neighbors = [
    ...nodes.slice(position + 1),
    ...nodes.slice(0, Math.max(0, position)).reverse()
  ].flatMap(node => (node.dataset.person ? [node.dataset.person] : []))
  const entry: ReturnPosition = {
    url: location.pathname + location.search,
    person: visible?.dataset.person,
    neighbors,
    offset: visible?.getBoundingClientRect().top || 0,
    y: window.scrollY,
    at: Date.now()
  }
  try {
    const records = JSON.parse(sessionStorage.getItem(KEY) || '{}')
    records[location.key] = entry
    sessionStorage.setItem(
      KEY,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(records)
            .sort((a, b) => (b[1] as ReturnPosition).at - (a[1] as ReturnPosition).at)
            .slice(0, 20)
        )
      )
    )
  } catch {
    /* 会话存储不可用时，URL与页码仍可工作，只降级像素定位。 */
  }
}
export function getReturn(key?: string): ReturnPosition | null {
  try {
    return key ? JSON.parse(sessionStorage.getItem(KEY) || '{}')[key] || null : null
  } catch {
    return null
  }
}
export function restoreList(key: string) {
  const record = getReturn(key)
  if (!record) return
  requestAnimationFrame(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-person]')]
    const target = [record.person, ...(record.neighbors || [])]
      .map(id => nodes.find(node => node.dataset.person === id))
      .find(Boolean)
    window.scrollTo({
      top: target ? window.scrollY + target.getBoundingClientRect().top - record.offset : record.y,
      behavior: 'instant'
    })
    if (target) target.querySelector<HTMLElement>('a')?.focus({ preventScroll: true })
    else document.querySelector<HTMLElement>('.results')?.focus({ preventScroll: true })
  })
}
