/** 独立作品库只加载轻量索引，共用人物页的WorkBrowser；不会在浏览时发起采集。 */
import { useApp } from '../app/context'
import { resource } from '../data/repository'
import type { WorkIndex } from '../entities/work'
import { useResource } from '../shared/useResource'
import { WorkBrowser } from '../features/works/WorkBrowser'
export default function WorksPage() {
  const { manifest } = useApp()
  const file = manifest?.works?.index
  const request = useResource(file || '', () => resource<WorkIndex>(file!))
  return (
    <>
      <header className="page-heading">
        <div>
          <h1>作品库</h1>
          <p className="muted">按番号、标题、人物或发行资料查找本地作品。</p>
        </div>
      </header>
      {!manifest ? (
        <p>正在读取资料…</p>
      ) : !file ? (
        <p>当前数据版本尚未提供作品索引，请更新网页数据。</p>
      ) : request.error ? (
        <p role="alert">
          {request.error} <button onClick={request.retry}>重试</button>
        </p>
      ) : !request.value ? (
        <p>正在读取作品…</p>
      ) : (
        <WorkBrowser entries={request.value.entries} actors={request.value.actors} />
      )}
    </>
  )
}
