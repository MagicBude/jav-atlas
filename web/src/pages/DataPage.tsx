/**
 * @file 数据覆盖与个人备份页面。原始快照下载和个人数据导出是两种独立操作。
 * 导入先验证再预览，冲突默认保留本地；不使用备份时间戳替用户决定覆盖。
 */
import { useState } from 'react'
import { SourceInformation } from '../features/sources/SourceInformation'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { asset, resource } from '../data/repository'
import { localValue, parseData, same, type UserData } from '../data/personal'
import { useResource } from '../shared/useResource'
import { RawTree } from '../shared/RawTree'
import { emptyPrivate } from '../features/people/query'
export function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
interface Conflict {
  key: string
  label: string
  local: unknown
  incoming: unknown
}
export default function DataPage() {
  const { manifest, data, repository, commit, notify, error } = useApp()
  const navigate = useNavigate()
  const report = useResource<Record<string, unknown>>(manifest ? manifest.report : '', () =>
    resource(manifest!.report)
  )
  const [preview, setPreview] = useState<{
    data: UserData
    raw: string
    conflicts: Conflict[]
  } | null>(null)
  const [choices, setChoices] = useState<Record<string, boolean>>({}),
    [shown, setShown] = useState(40)
  const [tag, setTag] = useState(''),
    [newTag, setNewTag] = useState('')
  const privateTags = [
    ...new Set(
      Object.values(data.records).flatMap(record => {
        const value = localValue(record, 'personalTags')
        return Array.isArray(value) ? value : []
      })
    )
  ].sort()
  const batchResults = Array.isArray(report.value?.results)
    ? (report.value.results as { mnid: string; avatar: string; profile: string }[])
    : []
  const inspectBatch = (kind: 'avatar' | 'profile') =>
    navigate('/people?source=minnano', {
      state: {
        privateFilters: {
          ...emptyPrivate(),
          batch: batchResults
            .filter(row =>
              kind === 'avatar' ? row.avatar === 'missing' : row.profile === 'failed'
            )
            .map(row => `minnano/${row.mnid}`)
        }
      }
    })
  const exportData = () => {
    try {
      const value = repository.raw()
      download(
        `jav-atlas-personal-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(
          {
            formatVersion: 1,
            app: 'jav-atlas',
            exportedAt: new Date().toISOString(),
            userData: JSON.parse(value)
          },
          null,
          2
        )
      )
      notify('个人备份已生成；其中不包含头像或整站名册。')
    } catch (failure) {
      notify(String(failure))
    }
  }
  const inspect = async (file?: File) => {
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) throw Error('文件超过 5 MB，请先拆分。')
      const parsed = JSON.parse(await file.text()),
        incoming = parseData(JSON.stringify(parsed.userData || parsed)),
        current = repository.read(),
        conflicts: Conflict[] = []
      for (const [key, r] of Object.entries(incoming.records)) {
        const previous = current.records[key]
        if (!previous) continue
        if (r.favorite && previous.favorite && !same(r.favorite, previous.favorite))
          conflicts.push({
            key: `${key}/favorite`,
            label: `${r.snapshot.name} / 收藏状态`,
            local: previous.favorite.active,
            incoming: r.favorite.active
          })
        for (const [field, op] of Object.entries(r.fields))
          if (previous.fields[field] && !same(op, previous.fields[field]))
            conflicts.push({
              key: `${key}/${field}`,
              label: `${r.snapshot.name} / ${field}`,
              local: previous.fields[field],
              incoming: op
            })
      }
      setPreview({ data: incoming, raw: repository.raw(), conflicts })
      setChoices({})
      setShown(40)
    } catch (failure) {
      notify(`未导入：${failure instanceof Error ? failure.message : String(failure)}`)
    }
  }
  return (
    <main className="document-page">
      <p className="eyebrow">SOURCES & PERSONAL DATA</p>
      <h1>数据与本地资料</h1>
      <p className="muted">了解采集范围，查看原始数据，备份自己的收藏与修改。</p>
      <details className="data-source-details">
        <summary>采集来源与字段说明</summary>
        <SourceInformation />
      </details>
      <section>
        <h2>来源与覆盖</h2>
        {manifest && (
          <>
            <p>
              数据版本 <code>{manifest.version}</code> · 构建时间{' '}
              {new Date(manifest.generatedAt).toLocaleString('zh-CN')}
            </p>
            <div className="coverage-grid">
              {Object.entries(manifest.sources).map(([source, item]) => (
                <div key={source}>
                  <h3>{source}</h3>
                  <p>
                    <strong>{item.count.toLocaleString()}</strong> 条来源记录
                  </p>
                  <p>{item.avatars.toLocaleString()} 个有效头像引用</p>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="muted">
          不同来源未合并身份。详情成功不代表所有字段齐全；无码记录是出演样本，不是完整作品库。
        </p>
        {report.error && <p className="error">{report.error}</p>}
        {report.value && (
          <details>
            <summary>最近采集批次及全册统计</summary>
            <RawTree value={report.value} />
          </details>
        )}
      </section>
      <div className="detail-actions">
        <button
          disabled={!batchResults.some(row => row.avatar === 'missing')}
          onClick={() => inspectBatch('avatar')}
        >
          查看最近批次缺头像人物
        </button>
        <button
          disabled={!batchResults.some(row => row.profile === 'failed')}
          onClick={() => inspectBatch('profile')}
        >
          查看最近批次详情失败人物
        </button>
      </div>
      <section>
        <h2>完整原始快照</h2>
        <p className="muted">
          下载部署时的采集 JSON，保留源字段与集合元数据。大文件仅在点击下载时读取。
        </p>
        <ul className="download-list">
          {Object.entries(manifest?.rawFiles || {}).map(([name, file]) => (
            <li key={name}>
              <a href={asset(file)} download>
                {name} ↓
              </a>
            </li>
          ))}
        </ul>
      </section>
      <section id="personal-data">
        <h2>我的本地数据</h2>
        <p>
          已收藏 {Object.values(data.records).filter(r => r.favorite?.active).length} 条；保留{' '}
          {Object.keys(data.records).length} 条个人记录（包含取消标记与未收藏的修改）。
        </p>
        <p className="muted">
          仅存在当前浏览器的这个站点。更换设备、浏览器或域名需手动导入；清除站点数据可能删除个人资料。
        </p>
        {error && (
          <p role="alert" className="notice error">
            {error}
            <button
              onClick={() => {
                try {
                  download('jav-atlas-original-storage.json', repository.raw())
                } catch (failure) {
                  notify(String(failure))
                }
              }}
            >
              导出原始存储文本
            </button>
          </p>
        )}
        <div className="detail-actions">
          <button className="primary" onClick={exportData}>
            导出全部个人数据
          </button>
          <label className="button">
            导入 JSON
            <input
              className="file-input"
              type="file"
              accept="application/json,.json"
              onChange={event => {
                inspect(event.target.files?.[0])
                event.target.value = ''
              }}
            />
          </label>
          <button
            onClick={() => {
              if (
                window.confirm(
                  '清空收藏、备注、本地修改及删除标记？此操作不可撤销，请先导出备份。源站资料不受影响。'
                )
              ) {
                if (commit(() => repository.reset())) notify('个人数据已清空，源数据保持不变。')
              }
            }}
          >
            清空个人数据
          </button>
        </div>
        {preview && (
          <div className="import-preview">
            <h3>导入预览</h3>
            <p>
              {Object.keys(preview.data.records).length} 条个人记录，{preview.conflicts.length}{' '}
              个冲突。无冲突内容会合并，冲突默认保留本地。
            </p>
            <div className="detail-actions">
              <button onClick={() => setChoices({})}>冲突全部保留本地</button>
              <button
                onClick={() =>
                  setChoices(Object.fromEntries(preview.conflicts.map(c => [c.key, true])))
                }
              >
                冲突全部使用导入
              </button>
            </div>
            {preview.conflicts.slice(0, shown).map(conflict => (
              <div className="conflict-row" key={conflict.key}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={!!choices[conflict.key]}
                    onChange={event =>
                      setChoices({ ...choices, [conflict.key]: event.target.checked })
                    }
                  />
                  使用导入：{conflict.label}
                </label>
                <details>
                  <summary>对照内容</summary>
                  <h4>本地</h4>
                  <RawTree value={conflict.local} />
                  <h4>导入</h4>
                  <RawTree value={conflict.incoming} />
                </details>
              </div>
            ))}
            {shown < preview.conflicts.length && (
              <button onClick={() => setShown(value => value + 40)}>查看更多冲突</button>
            )}
            <footer className="sticky-actions">
              <button onClick={() => setPreview(null)}>取消导入</button>
              <button
                className="primary"
                onClick={() => {
                  if (commit(() => repository.import(preview.data, choices, preview.raw))) {
                    setPreview(null)
                    notify('个人数据已合并保存。')
                  }
                }}
              >
                确认合并
              </button>
            </footer>
          </div>
        )}
      </section>
      <section>
        <h2>管理个人标签</h2>
        <p className="muted">只改个人标签关联，不取消收藏、不删除备注，不影响来源标签。</p>
        <div className="inline-form">
          <select
            aria-label="要管理的个人标签"
            value={tag}
            onChange={event => setTag(event.target.value)}
          >
            <option value="">选择标签</option>
            {privateTags.map(label => (
              <option key={label}>{label}</option>
            ))}
          </select>
          <input
            aria-label="标签新名称"
            value={newTag}
            placeholder="新名称"
            onChange={event => setNewTag(event.target.value)}
          />
          <button
            disabled={!tag || !newTag.trim()}
            onClick={() => {
              if (commit(() => repository.renameTag(tag, newTag.trim()))) {
                setTag('')
                setNewTag('')
                notify('个人标签已重命名。')
              }
            }}
          >
            重命名
          </button>
          <button
            disabled={!tag}
            onClick={() => {
              if (
                window.confirm(`移除所有人物上的“${tag}”标签？收藏与备注仍保留。`) &&
                commit(() => repository.renameTag(tag, ''))
              ) {
                setTag('')
                notify('标签关联已移除。')
              }
            }}
          >
            删除标签
          </button>
        </div>
      </section>
    </main>
  )
}
