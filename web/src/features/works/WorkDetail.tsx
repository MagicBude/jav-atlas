/** @file 作品详情共用内容：人物内弹窗和独立页共用，只读加载本项目资源。 */
import { Link } from 'react-router-dom'
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import { safeUrl } from '../../entities/person'
import type { WorkDetail as Work } from '../../entities/work'
import { useResource } from '../../shared/useResource'
import { RawTree } from '../../shared/RawTree'
import { WorkEnrichment } from './WorkEnrichment'
export function WorkDetail({ id }: { id: string }) {
  const { manifest } = useApp()
  const file = manifest?.works?.records[id]
  const request = useResource(file || '', () => resource<Work>(file!))
  if (!manifest) return <p>正在读取资料…</p>
  if (!file) return <p>当前资料未收录这部作品的详情。</p>
  if (request.error)
    return (
      <p role="alert">
        {request.error}
        <button onClick={request.retry}>重试</button>
      </p>
    )
  if (!request.value) return <p>正在读取作品…</p>
  const work = request.value
  return (
    <div className="work-detail">
      <p className="eyebrow">MINNANO · #{work.id}</p>
      <h2>{work.title}</h2>
      <dl className="facts">
        <div>
          <dt>番号</dt>
          <dd>{work.code || '未知'}</dd>
        </div>
        <div>
          <dt>发行日期</dt>
          <dd>{work.releaseDate || '未知'}</dd>
        </div>
        <div>
          <dt>厂商 / 厂牌</dt>
          <dd>{work.makerText || '未知'}</dd>
        </div>
      </dl>
      <h3>出演者</h3>
      <div className="work-cast">
        {work.cast?.map(actor =>
          manifest.works?.people[actor.id] ? (
            <Link key={actor.id} to={`/people/minnano/${actor.id}`}>
              {actor.name}
            </Link>
          ) : (
            <a
              key={actor.id}
              href={`https://www.minnano-av.com/actress${encodeURIComponent(actor.id)}.html`}
              target="_blank"
              rel="noreferrer"
            >
              {actor.name} ↗
            </a>
          )
        )}
      </div>
      {safeUrl(work.sourceUrl) && (
        <a className="button" href={safeUrl(work.sourceUrl)} target="_blank" rel="noreferrer">
          查看来源 ↗
        </a>
      )}
      <WorkEnrichment id={id} />
      <details className="work-raw">
        <summary>原始作品资料</summary>
        <RawTree value={work} />
      </details>
    </div>
  )
}
