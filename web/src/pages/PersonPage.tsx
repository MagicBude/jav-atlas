/**
 * @file 同一人物内容既可放入桌面抽屉，也可独立成页。
 * 规范资料使用个人覆盖视图；原始区始终读完整来源记录，避免本地编辑污染原文。
 */

import { SourceRecordLink } from '../shared/SourceRecordLink'
import { sourceRecordUrl } from '../entities/dataSources'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useApp, operation } from '../app/context'
import { loadDetail, loadIndex } from '../data/repository'
import { localValue, resolvePerson, same } from '../data/personal'
import {
  display,
  fields,
  identity,
  personUrl,
  safeUrl,
  type Person,
  type Source
} from '../entities/person'
import { useResource } from '../shared/useResource'
import { PersonAvatar } from '../shared/PersonAvatar'
import { HeartIcon } from '../shared/HeartIcon'
import { PersonWorks } from '../features/works/PersonWorks'
import { RawTree } from '../shared/RawTree'
import PersonEditor, { createDraft } from '../features/personal-data/PersonEditor'
import { getReturn } from '../features/people/returnPosition'
export default function PersonPage({
  drawer = false,
  close,
  full
}: {
  drawer?: boolean
  close?: () => void
  full?: () => void
}) {
  const { source = '', id = '' } = useParams(),
    location = useLocation(),
    navigate = useNavigate()
  const { manifest, data, favorite, drafts, setDraft, repository, commit } = useApp()
  const valid = ['minnano', 'javdb'].includes(source) && /^[a-zA-Z0-9_-]+$/.test(id)
  // 分区属于可分享的URL状态；作品参数的旧链接仍自动打开作品区。
  const params = new URLSearchParams(location.search)
  const sections = [
    'basic',
    ...(source === 'minnano' ? ['works'] : []),
    'related',
    'personal',
    'raw'
  ]
  const requestedSection =
    params.get('section') ||
    (['work', 'wq', 'wp', 'wy', 'wm', 'ws', 'wd'].some(key => params.has(key)) &&
    source === 'minnano'
      ? 'works'
      : 'basic')
  const activeSection = sections.includes(requestedSection) ? requestedSection : 'basic'
  const switchSection = (section: string) => {
    const next = new URLSearchParams(location.search)
    next.set('section', section)
    // 替换而非堆叠历史：关闭人物仍能返回原列表；各分区保持挂载以保留输入与滚动内容。
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: true, state: location.state }
    )
  }
  const index = useResource(manifest && valid ? `${manifest.version}:${source}` : '', () =>
    loadIndex(manifest!, source as Source)
  )
  const sourcePerson = index.value?.find(p => p.id === id)
  const record = data.records[`${source}/${id}`]
  const fallback = record
    ? ({
        source: record.source,
        id,
        name: record.snapshot.name,
        aliases: [],
        gender: '?',
        birthday: '',
        height: null,
        breast: null,
        waist: null,
        hip: null,
        cup: '',
        blood: '',
        place: '',
        agency: '',
        hobby: '',
        shoe: '',
        official: '',
        tags: [],
        avatar: null,
        status: 'directory',
        fetchedAt: null,
        genderEvidence: '当前版本未收录',
        sourceUrl: record.snapshot.sourceUrl,
        detailRef: ''
      } as Person)
    : undefined
  const sourceValue = sourcePerson || fallback
  const detail = useResource(
    sourcePerson ? `${manifest?.version}:detail:${source}/${id}` : '',
    () => loadDetail(sourcePerson!)
  )
  if (!valid)
    return (
      <div className="empty-state">
        <h1>人物地址无效</h1>
        <a href="#/people">返回人物页</a>
      </div>
    )
  if (index.error)
    return (
      <div className="notice error">
        {index.error}
        <button onClick={index.retry}>重试</button>
      </div>
    )
  if (!index.value) return <div className="empty-state">正在读取人物资料…</div>
  if (!sourceValue)
    return (
      <div className="empty-state">
        <h1>当前数据未收录此人物</h1>
        <p>源站 ID：{id}；不会把缺失资料当成完整人物。</p>
        <a href="#/people">返回人物页</a>
      </div>
    )
  const person = resolvePerson(sourceValue, record),
    key = identity(person),
    saved = !!record?.favorite?.active
  const returnRef = getReturn(location.state?.returnKey)
  // 从作品出演者跳入人物时保留一次明确返回，不把作品层再叠成新人物抽屉。
  const fromWork = location.state?.workOrigin
  const hasWorkOrigin =
    typeof fromWork?.pathname === 'string' &&
    (/^\/works(?:\/minnano\/\d+)?$/.test(fromWork.pathname) ||
      fromWork.pathname === '/search' ||
      /^\/people\/minnano\/\d+$/.test(fromWork.pathname))
  const back = () => {
    if (hasWorkOrigin) {
      navigate(-1)
      return
    }
    if (close) {
      close()
      return
    }
    const depth = Number(location.state?.depth) || 1
    if (returnRef && location.state?.returnKey) navigate(-depth)
    else navigate(`/people?source=${source}`, { replace: true })
  }
  const relatedState = {
    ...location.state,
    depth: (Number(location.state?.depth) || 1) + (drawer ? 0 : 1)
  }
  const switchPerson = (otherId: string) =>
    navigate(personUrl({ source: source as Source, id: otherId }), {
      replace: drawer,
      state: relatedState
    })
  const sequence: string[] = location.state?.sequence || [],
    position = sequence.indexOf(key)
  return (
    <div className={`person-detail ${drawer ? 'in-drawer' : ''}`}>
      <header className="detail-toolbar">
        <button className="text-button" onClick={back}>
          {hasWorkOrigin
            ? '‹ 返回刚才的作品'
            : drawer
              ? '关闭 ×'
              : returnRef
                ? '‹ 返回之前的结果'
                : '‹ 返回人物列表'}
        </button>
        {drawer && (
          <button className="text-button" onClick={full}>
            完整页 ↗
          </button>
        )}
      </header>
      <div className="person-summary">
        <div className="identity-block">
          <PersonAvatar
            key={sourceValue.avatar}
            file={sourceValue.avatar}
            name={person.name}
            large
          />
          <div>
            <p className="eyebrow">
              {source} / <code>{id}</code>
            </p>
            <h1>{person.name || '未命名'}</h1>
            {person.aliases?.length > 0 && (
              <p className="muted aliases">{person.aliases.join(' / ')}</p>
            )}
            {!sourcePerson && <span className="badge">当前数据未收录 · 保留个人快照</span>}
            <div className="person-quick-facts">
              {person.height != null && <span>{person.height} cm</span>}
              {person.cup && <span>{person.cup} 杯</span>}
              {person.birthday && <span>{person.birthday.slice(0, 4)} 年生</span>}
            </div>
          </div>
        </div>
        <div className="detail-actions">
          <button
            aria-pressed={saved}
            className={`favorite-action ${saved ? 'is-favorite' : ''}`}
            onClick={() => favorite(sourceValue)}
          >
            <HeartIcon active={saved} />
            {saved ? '已收藏' : '收藏人物'}
          </button>
          <button onClick={() => setDraft(key, drafts[key] || createDraft(sourceValue, record))}>
            修改本地资料
          </button>
          <SourceRecordLink
            source={sourceValue.source}
            entity="person"
            id={sourceValue.id}
            className="button primary"
          >
            查看来源 ↗
          </SourceRecordLink>
        </div>
      </div>
      {drafts[key] ? (
        <PersonEditor person={sourceValue} />
      ) : (
        <>
          <nav className="section-nav" aria-label="人物资料区块">
            {[
              ['basic', '基本资料'],
              ...(source === 'minnano' ? [['works', '作品']] : []),
              ['related', '相关人物'],
              ['personal', '我的资料'],
              ['raw', '原始资料']
            ].map(([target, label]) => (
              <button
                key={target}
                aria-pressed={activeSection === target}
                aria-controls={`${key}-${target}`}
                onClick={() => switchSection(target)}
              >
                {label}
              </button>
            ))}
          </nav>
          <section id={`${key}-basic`} hidden={activeSection !== 'basic'}>
            <h2>基本资料</h2>
            <dl className="facts">
              {fields
                .filter(field => field.key !== 'name')
                .map(field => {
                  const value = person[field.key],
                    own = record?.fields[field.key]
                  return (
                    <div key={field.key}>
                      <dt>{field.label.replace('（逗号分隔）', '')}</dt>
                      <dd>
                        {field.key === 'gender' ? (
                          { f: '女', m: '男', '?': '未知' }[String(value)] || '未知'
                        ) : field.kind === 'url' && safeUrl(value) ? (
                          <a href={safeUrl(value)} target="_blank" rel="noreferrer">
                            {String(value)} ↗
                          </a>
                        ) : (
                          display(value)
                        )}
                        {own?.kind === 'set' && (
                          <span className="local-mark">
                            本地{own.base == null || own.base === '' ? '补充' : '修改'}
                          </span>
                        )}
                        {own?.kind === 'set' && !same(own.base, sourceValue[field.key]) && (
                          <div className="notice small">
                            来源已更新：{display(sourceValue[field.key])}
                            <button
                              onClick={() =>
                                commit(() =>
                                  repository.patch(
                                    sourceValue,
                                    {
                                      [field.key]: operation(
                                        'set',
                                        own.value,
                                        sourceValue[field.key] ?? null
                                      )
                                    },
                                    { [field.key]: own }
                                  )
                                )
                              }
                            >
                              保留我的值
                            </button>
                            <button
                              onClick={() =>
                                commit(() =>
                                  repository.patch(
                                    sourceValue,
                                    {
                                      [field.key]: operation(
                                        'clear',
                                        null,
                                        sourceValue[field.key] ?? null
                                      )
                                    },
                                    { [field.key]: own }
                                  )
                                )
                              }
                            >
                              使用来源值
                            </button>
                          </div>
                        )}
                      </dd>
                    </div>
                  )
                })}
            </dl>
            <p className="small muted">
              未知表示来源未提供或尚未采集。性别依据：{sourceValue.genderEvidence}
              ；本地值不是来源证据。
            </p>
            <div className="tag-list">
              {person.tags.map(tag => (
                <span className="badge" key={tag.value}>
                  {tag.label}
                </span>
              ))}
            </div>
          </section>
          <section id={`${key}-personal`} hidden={activeSection !== 'personal'}>
            <h2>我的资料</h2>
            <p className="muted">个人标签：{display(localValue(record, 'personalTags'))}</p>
            <p className="personal-note">{display(localValue(record, 'note'))}</p>
            {Object.entries(record?.fields || {})
              .filter(([field, op]) => field.startsWith('custom:') && op.kind === 'set')
              .map(([field, op]) => (
                <p key={field}>
                  <strong>{field.slice(7)}：</strong>
                  {display(op.value)}
                </p>
              ))}
            <button onClick={() => setDraft(key, createDraft(sourceValue, record))}>
              编辑备注与标签
            </button>
            {Object.values(record?.fields || {}).some(op => op.kind === 'set') && (
              <button
                onClick={() => {
                  if (window.confirm('恢复此人物的全部来源值并清空其备注和标签？收藏仍保留。')) {
                    const changes = Object.fromEntries(
                      Object.keys(record!.fields).map(field => [
                        field,
                        operation('clear', null, null)
                      ])
                    )
                    commit(() => repository.patch(sourceValue, changes, record!.fields))
                  }
                }}
              >
                清除此人物的本地修改
              </button>
            )}
          </section>
          <section id={`${key}-raw`} hidden={activeSection !== 'raw'}>
            <h2>原始资料</h2>
            <p className="small muted">
              资料取得时间：
              {person.fetchedAt ? new Date(person.fetchedAt).toLocaleString('zh-CN') : '未知'}
            </p>
            <p className="muted small">
              以下始终展示来源记录；本地修改不会覆盖这里。重复标签、链接与未映射字段均保留。
            </p>
            {detail.error && (
              <div className="notice error">
                {detail.error}
                <button onClick={detail.retry}>重试</button>
                <button onClick={() => window.location.reload()}>刷新站点</button>
              </div>
            )}
            {sourcePerson && !detail.value && !detail.error && <p>正在读取完整资料块…</p>}
            {!sourcePerson && <p>当前版本没有源记录，已保存的个人资料仍可使用。</p>}
            {detail.value &&
              Object.entries(detail.value.records).map(([name, raw]) => (
                <div className="source-record" key={name}>
                  <h3>
                    {name === 'directory'
                      ? 'minnano 人物记录'
                      : name === 'actors'
                        ? 'JavDB 普通详情'
                        : name === 'uncensored'
                          ? 'JavDB 无码出演样本'
                          : '性别原始证据'}
                  </h3>
                  {Array.isArray(raw.profileFields) && (
                    <dl className="raw-fields">
                      {raw.profileFields.map(
                        (
                          f: {
                            label: string
                            text: string
                            links?: { text: string; url: string }[]
                          },
                          i: number
                        ) => (
                          <div key={i}>
                            <dt>{f.label}</dt>
                            <dd>
                              {f.text}
                              {f.links?.map(
                                (link, j) =>
                                  safeUrl(link.url) && (
                                    <a
                                      key={j}
                                      href={safeUrl(link.url)}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      {link.text || link.url} ↗
                                    </a>
                                  )
                              )}
                            </dd>
                          </div>
                        )
                      )}
                    </dl>
                  )}
                  <details>
                    <summary>查看此来源的全部原始字段</summary>
                    <RawTree value={raw} />
                  </details>
                </div>
              ))}
          </section>
          {source === 'minnano' && (
            <section id={`${key}-works`} hidden={activeSection !== 'works'}>
              <h2>作品</h2>
              <PersonWorks key={id} actorId={id} expanded={activeSection === 'works'} />
            </section>
          )}
          <section id={`${key}-related`} hidden={activeSection !== 'related'}>
            <h2>相关人物</h2>
            <div className="related-list">
              {detail.value?.related.length ? (
                detail.value.related.map((other, i) => {
                  // 旧资料的 rel 只保存原生 ID。以同一来源的名册补全展示信息，
                  // 不通过姓名跨站猜测身份，也不改写原始关联记录。
                  const known = index.value!.find(row => row.id === String(other.id))
                  const relatedName = known
                    ? resolvePerson(known, data.records[identity(known)]).name
                    : other.name && other.name !== String(other.id)
                      ? other.name
                      : '姓名未采集'
                  return (
                    <div key={`${other.id}-${i}`}>
                      <button
                        className="text-button related-person"
                        onClick={() => {
                          if (known) switchPerson(String(other.id))
                          else {
                            const url = sourceRecordUrl(source, 'person', String(other.id))
                            if (url) window.open(url, '_blank', 'noopener,noreferrer')
                          }
                        }}
                      >
                        <PersonAvatar
                          key={known?.avatar || other.id}
                          file={known?.avatar || null}
                          name={relatedName}
                        />
                        <span>
                          {relatedName}　›
                          <small>
                            {known
                              ? `${known.avatar ? '' : '暂无头像 · '}查看人物资料`
                              : '本地未收录 · 前往来源'}
                          </small>
                        </span>
                      </button>
                      <code>{other.id}</code>
                      {other.title && (
                        <details>
                          <summary>原始标题</summary>
                          <p>{other.title}</p>
                        </details>
                      )}
                    </div>
                  )
                })
              ) : (
                <p className="muted">当前记录没有已采集的相关人物。</p>
              )}
            </div>
          </section>
        </>
      )}
      {drawer && position >= 0 && (
        <footer className="neighbor-nav">
          <button
            disabled={position === 0}
            onClick={() => {
              const previous = sequence[position - 1].split('/')
              navigate(`/people/${previous[0]}/${previous[1]}`, {
                replace: true,
                state: location.state
              })
            }}
          >
            ‹ 上一位
          </button>
          <span className="muted small">
            当前结果页 {position + 1} / {sequence.length}
          </span>
          <button
            disabled={position >= sequence.length - 1}
            onClick={() => {
              const next = sequence[position + 1].split('/')
              navigate(`/people/${next[0]}/${next[1]}`, { replace: true, state: location.state })
            }}
          >
            下一位 ›
          </button>
        </footer>
      )}
    </div>
  )
}
