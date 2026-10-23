/**
 * @file 统一的作品阅读视图：核心值集中显示，每个字段保留来源；来源原记录只在底部展开。
 * 这只是展示投影，优先级不会写回两个来源，日期冲突和出演者署名继续分别保留。
 */
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import { safeUrl } from '../../entities/person'
import type { WorkDetail as Work } from '../../entities/work'
import type { Enrichment } from '../../entities/enrichment'
import { useResource } from '../../shared/useResource'
import { RawTree } from '../../shared/RawTree'
import { WorkEnrichment } from './WorkEnrichment'
import { facetUrl } from './query'
export function WorkDetail({ id }: { id: string }) {
  const { manifest } = useApp()
  const location = useLocation()
  const file = manifest?.works?.records[id],
    extraFile = manifest?.works?.enrichments?.[id]
  const request = useResource(file || '', () => resource<Work>(file!))
  const extra = useResource(extraFile || '', () => resource<Enrichment>(extraFile!))
  if (!manifest) return <p>正在读取资料…</p>
  // 分批任务可能已发现列表、尚未补齐详情；提供源站入口，不能把缺详情说成作品不存在。
  if (!file)
    return (
      <p>
        当前资料暂未提供这部作品的详情。{' '}
        {/^\d+$/.test(id) && (
          <a href={`https://www.minnano-av.com/av${id}.html`} target="_blank" rel="noreferrer">
            查看 minnano 来源页 ↗
          </a>
        )}
      </p>
    )
  if (request.error)
    return (
      <p role="alert">
        {request.error}
        <button onClick={request.retry}>重试</button>
      </p>
    )
  if (!request.value) return <p>正在读取作品…</p>
  const work = request.value,
    data = extra.value,
    m = data?.metadata
  const browse = (kind: string, id: string) =>
    facetUrl(kind, id, location.pathname, location.search)
  const prefix = work.code?.toUpperCase().match(/^([A-Z]+)(?=[-\d])/)?.[1]
  const facts = [
    {
      label: '日期',
      value: m?.release_date || work.releaseDate,
      source: m?.release_date ? 'JavDB' : 'minnano'
    },
    { label: '时长', value: m?.duration ? `${m.duration} 分钟` : null, source: 'JavDB' },
    {
      label: '导演',
      value: m?.director_name,
      source: 'JavDB',
      link: m?.director_id ? browse('director', m.director_id) : undefined
    },
    {
      label: '片商',
      value: m?.maker_name || work.makerText,
      source: m?.maker_name ? 'JavDB' : 'minnano',
      link: m?.maker_id
        ? browse('maker', m.maker_id)
        : work.makerText
          ? `/works?wm=${encodeURIComponent(work.makerText)}`
          : undefined
    },
    {
      label: '系列',
      value: m?.series_name,
      source: 'JavDB',
      link: m?.series_id ? browse('series', m.series_id) : undefined
    },
    {
      label: '评分',
      value: m?.score
        ? `${m.score} 分 · ${m.reviews_count?.toLocaleString('zh-CN') ?? '未知'} 人评价`
        : null,
      source: 'JavDB'
    }
  ]
  return (
    <div className="work-detail work-reading">
      <header className="work-hero">
        <div className="work-hero-copy">
          <p className="work-number">
            番号：
            {prefix ? (
              <>
                <Link to={browse('prefix', prefix)}>{prefix}</Link>
                {work.code?.slice(prefix.length)}
              </>
            ) : (
              work.code || `#${work.id}`
            )}
          </p>
          <h2>{work.title}</h2>
          <div className="work-source-links">
            {safeUrl(work.sourceUrl) && (
              <a href={safeUrl(work.sourceUrl)} target="_blank" rel="noreferrer">
                minnano ↗
              </a>
            )}
            {data && (
              <a
                href={`https://javdb.com/v/${encodeURIComponent(data.id)}`}
                target="_blank"
                rel="noreferrer"
              >
                JavDB ↗
              </a>
            )}
          </div>
        </div>
      </header>
      <dl className="facts work-core-facts">
        {facts
          .filter(f => f.value)
          .map(f => (
            <div key={f.label}>
              <dt>
                {f.label}
                <small>{f.source}</small>
              </dt>
              <dd>{f.link ? <Link to={f.link}>{f.value}</Link> : f.value}</dd>
            </div>
          ))}
        {m?.tags?.length ? (
          <div>
            <dt>
              类别 <small>JavDB</small>
            </dt>
            <dd>
              <div className="work-tags">
                {m.tags.map(t => (
                  <Link to={browse('tag', t.id)} className="badge" key={t.id}>
                    {t.name}
                  </Link>
                ))}
              </div>
            </dd>
          </div>
        ) : null}
        <div>
          <dt>
            演员 <small>minnano</small>
          </dt>
          <dd>
            <div className="work-cast">
              {work.cast?.map(a =>
                manifest.works?.people[a.id] ? (
                  <Link
                    key={a.id}
                    to={`/people/minnano/${a.id}`}
                    state={{
                      workOrigin: {
                        pathname: location.pathname,
                        search: location.search
                      }
                    }}
                  >
                    {a.name}
                  </Link>
                ) : (
                  <a
                    key={a.id}
                    href={`https://www.minnano-av.com/actress${encodeURIComponent(a.id)}.html`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {a.name} ↗
                  </a>
                )
              )}
            </div>
            {m?.actors?.length ? (
              <details className="cast-comparison">
                <summary>查看 JavDB 出演者署名</summary>
                <p className="small muted">署名和人数可能不同，未自动合并人物身份。</p>
                <div className="work-cast">
                  {m.actors.map(a => (
                    <a
                      key={a.id}
                      href={`https://javdb.com/actors/${encodeURIComponent(a.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.name} ↗
                    </a>
                  ))}
                </div>
              </details>
            ) : null}
          </dd>
        </div>
      </dl>
      {data?.mapping.dateDifference && (
        <details className="source-difference">
          <summary>发行日期有来源差异</summary>
          <p>
            minnano：{data.mapping.minnanoDate}
            <br />
            JavDB：{data.mapping.javdbDate}
          </p>
        </details>
      )}
      {extra.error && (
        <p role="alert">
          JavDB补充资料加载失败。<button onClick={extra.retry}>重试</button>
          <button onClick={() => window.location.reload()}>刷新网页数据</button>
        </p>
      )}
      {extraFile && !data && !extra.error && <p className="muted">正在读取评分和短评…</p>}
      {data && <WorkEnrichment key={data.id} data={data} />}
      <details className="work-provenance">
        <summary>资料来源与原始记录</summary>
        <p className="small muted">
          日期、片商及扩展字段优先使用JavDB，缺失时回退minnano；标题与主演员列表沿用minnano。来源差异保留，不回写原记录。
        </p>
        {data && (
          <p className="small muted">
            JavDB取得时间：{new Date(data.fetchedAt).toLocaleString('zh-CN')}
            {data.reviews.length > 0
              ? '；评论为已保存的有限样本，排序未确认。'
              : '；本轮仅补充基础元数据，未采集评论。'}
          </p>
        )}
        <details>
          <summary>minnano 完整记录</summary>
          <RawTree value={work} />
        </details>
        {data && (
          <details>
            <summary>JavDB 完整记录与匹配依据</summary>
            <RawTree value={data} />
          </details>
        )}
      </details>
    </div>
  )
}
