/**
 * @file 统一的作品阅读视图：核心值集中显示，每个字段保留来源；来源原记录只在底部展开。
 * 这只是展示投影，优先级不会写回两个来源，日期冲突和出演者署名继续分别保留。
 */
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import { SourceRecordLink } from '../../shared/SourceRecordLink'
import type { WorkDetail as Work } from '../../entities/work'
import type { Enrichment } from '../../entities/enrichment'
import { useResource } from '../../shared/useResource'
import { RawTree } from '../../shared/RawTree'
import { WorkEnrichment } from './WorkEnrichment'
import { facetUrl } from './query'
import { displayJavdbTags, javdbTagLabel, tagSelectionKey } from '../../entities/tagLabels'
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
          <SourceRecordLink source="minnano" entity="work" id={id}>
            查看 minnano 来源页 ↗
          </SourceRecordLink>
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
  const f = work.fanza?.metadata
  const browse = (kind: string, id: string) =>
    facetUrl(kind, id, location.pathname, location.search)
  const prefix = work.code?.toUpperCase().match(/^([A-Z]+)(?=[-\d])/)?.[1]
  const facts = [
    {
      label: '日期',
      value: m?.release_date || work.releaseDate,
      source: m?.release_date ? 'JavDB' : 'minnano'
    },
    {
      label: '时长',
      value: m?.duration
        ? `${m.duration} 分钟`
        : f?.durationSeconds
          ? `${Math.floor(f.durationSeconds / 60)} 分 ${f.durationSeconds % 60} 秒`
          : null,
      source: m?.duration ? 'JavDB' : 'FANZA'
    },
    {
      label: '导演',
      value: m?.director_name || f?.directors.map(row => row.name).join('、'),
      source: m?.director_name ? 'JavDB' : 'FANZA',
      link: m?.director_id ? browse('director', m.director_id) : undefined
    },
    {
      label: '片商',
      value: m?.maker_name || work.makerText || f?.maker?.name,
      source: m?.maker_name ? 'JavDB' : work.makerText ? 'minnano' : 'FANZA',
      link: m?.maker_id
        ? browse('maker', m.maker_id)
        : work.makerText
          ? `/works?wm=${encodeURIComponent(work.makerText)}`
          : undefined
    },
    {
      label: '系列',
      value: m?.series_name || f?.series?.name,
      source: m?.series_name ? 'JavDB' : 'FANZA',
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
            <SourceRecordLink source="minnano" entity="work" id={work.id} />
            {data && <SourceRecordLink source="javdb" entity="work" id={data.id} />}
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
                {displayJavdbTags(m.tags, m.type).map(t => (
                  <Link
                    to={browse('tag', tagSelectionKey(t.id, t.name, m.type))}
                    className="badge"
                    key={t.id}
                  >
                    <span title={`JavDB原名称：${t.name}`}>
                      {javdbTagLabel(t.id, t.name, m.type)}
                    </span>
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
                  <SourceRecordLink key={a.id} source="minnano" entity="person" id={a.id}>
                    {a.name} ↗
                  </SourceRecordLink>
                )
              )}
            </div>
            {m?.actors?.length ? (
              <details className="cast-comparison">
                <summary>查看 JavDB 出演者署名</summary>
                <p className="small muted">署名和人数可能不同，未自动合并人物身份。</p>
                <div className="work-cast">
                  {m.actors.map(a => (
                    <SourceRecordLink key={a.id} source="javdb" entity="person" id={a.id}>
                      {a.name} ↗
                    </SourceRecordLink>
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
          标题与主演员列表沿用minnano；其他字段标注各自来源，FANZA仅补空缺。来源差异保留，不回写原记录。
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
          <RawTree value={Object.fromEntries(Object.entries(work).filter(([key]) => key !== 'fanza'))} />
        </details>
        {work.fanza && (
          <details>
            <summary>FANZA 补充记录</summary>
            <p className="small muted">取得时间：{new Date(work.fanza.fetchedAt).toLocaleString('zh-CN')}</p>
            <RawTree value={work.fanza} />
          </details>
        )}
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
