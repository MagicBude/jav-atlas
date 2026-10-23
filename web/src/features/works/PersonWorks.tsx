/** 人物作品加载层：资源与错误在此处理，实际查询/排版复用WorkBrowser。 */
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import type { PersonWorks as Collection } from '../../entities/work'
import { useResource } from '../../shared/useResource'
import { WorkBrowser } from './WorkBrowser'
export function PersonWorks({
  actorId,
  expanded = false
}: {
  actorId: string
  expanded?: boolean
}) {
  const { manifest } = useApp(),
    location = useLocation()
  const params = new URLSearchParams(location.search)
  const file = manifest?.works?.people[actorId]
  const [opened, setOpened] = useState(false)
  const active =
    expanded || opened || ['work', 'wq', 'wp', 'wy', 'wm', 'ws', 'wd'].some(key => params.has(key))
  const request = useResource(active && file ? file : '', () => resource<Collection>(file!))
  if (!file) return <p className="muted">这位人物的作品列表暂未提供。</p>
  return (
    <>
      <p className="muted small">来源收录作品，不代表全部出演记录。</p>
      {!active ? (
        <button className="button" onClick={() => setOpened(true)}>
          查看作品列表
        </button>
      ) : request.error ? (
        <p role="alert">
          {request.error} <button onClick={request.retry}>重试</button>
        </p>
      ) : !request.value ? (
        <p>正在读取作品…</p>
      ) : (
        <WorkBrowser entries={request.value.entries} />
      )}
    </>
  )
}
