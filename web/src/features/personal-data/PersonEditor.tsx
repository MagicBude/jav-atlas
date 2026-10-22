/**
 * @file 字段级本地编辑器。表单草稿只在内存；成功写入后才退出编辑模式。
 * 每个字段独立记录 keep/set/clear/unknown，避免把恢复来源误解成清空源站数据。
 */
import { useEffect, useState } from 'react'
import { useApp, operation, type Draft } from '../../app/context'
import {
  localValue,
  PersonalConflict,
  resolvePerson,
  type Operation,
  type PersonalRecord
} from '../../data/personal'
import { display, fields, identity, safeUrl, type Person, type Value } from '../../entities/person'
export function createDraft(
  person: Person,
  record: ReturnType<typeof useApp>['data']['records'][string] | undefined
): Draft {
  const effective = resolvePerson(person, record),
    values: Record<string, string> = {},
    modes: Record<string, string> = {}
  for (const field of fields) {
    const value = effective[field.key]
    values[field.key] = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
    modes[field.key] = 'keep'
  }
  for (const key of [
    'note',
    'personalTags',
    ...Object.keys(record?.fields || {}).filter(key => key.startsWith('custom:'))
  ]) {
    const value = localValue(record, key)
    values[key] = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value)
    modes[key] = 'keep'
  }
  return { values, modes, base: record ? structuredClone(record) : undefined, dirty: false }
}
/** 解析输入只改变本地字段。非法值明确报错，不用 parseInt 把半合法字符串误当作成功。 */
export function parseInput(key: string, input: string): Value {
  const text = input.trim(),
    field = fields.find(field => field.key === key)
  if (!text) return null
  if (field?.kind === 'number') {
    const number = Number(text)
    if (!Number.isFinite(number) || number <= 0 || number > 400)
      throw Error(`${field.label}应为 0 到 400 之间的有效数值。`)
    return number
  }
  if (field?.kind === 'date') {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
      !Number.isFinite(Date.parse(text)) ||
      new Date(text).toISOString().slice(0, 10) !== text ||
      text > new Date().toISOString().slice(0, 10)
    )
      throw Error('请输入有效且不晚于今天的生日。')
  }
  if (field?.kind === 'url' && !safeUrl(text)) throw Error('链接只允许 http:// 或 https://。')
  if (field?.kind === 'aliases' || key === 'personalTags')
    return [
      ...new Set(
        text
          .split(/[,，、]/)
          .map(value => value.trim())
          .filter(Boolean)
      )
    ]
  if (key === 'gender' && !['f', 'm', '?'].includes(text)) throw Error('性别请选择女、男或未知。')
  return text
}
export default function PersonEditor({ person }: { person: Person }) {
  const { drafts, setDraft, repository, commit, notify, saveDraft } = useApp(),
    key = identity(person),
    draft = drafts[key]
  const [error, setError] = useState(''),
    [conflicts, setConflicts] = useState<string[]>([]),
    [customName, setCustomName] = useState('')
  const [conflictingRecord, setConflictingRecord] = useState<PersonalRecord | undefined>(undefined)
  const update = (field: string, value: string, mode = 'set') =>
    setDraft(key, {
      ...draft,
      dirty: true,
      values: { ...draft.values, [field]: value },
      modes: { ...draft.modes, [field]: mode }
    })
  const save = (confirmed = false) => {
    if (conflicts.length && !confirmed) {
      setError('请先核对其他标签页的修改，再明确确认冲突字段。')
      return false
    }
    try {
      const changes: Record<string, Operation> = {},
        expected: Record<string, Operation | undefined> = {}
      for (const [field, mode] of Object.entries(draft.modes)) {
        if (mode === 'keep') continue
        const base = (person as unknown as Record<string, Value>)[field] ?? null
        const value = mode === 'unknown' ? null : parseInput(field, draft.values[field] || '')
        changes[field] = operation(
          mode === 'clear' || (mode === 'set' && value === null) ? 'clear' : 'set',
          value,
          base
        )
        if (mode === 'unknown') changes[field] = operation('set', null, base)
        expected[field] = draft.base?.fields[field]
      }
      if (!Object.keys(changes).length) {
        setDraft(key)
        return true
      }
      // 冲突单独捕获，保留所有草稿；下一次确认仍会重新读取存储，不使用过时版本。
      let saved = false
      const success = commit(() => {
        try {
          const result = repository.patch(person, changes, expected)
          saved = true
          return result
        } catch (failure) {
          if (failure instanceof PersonalConflict) {
            setConflicts(failure.conflicts)
            setConflictingRecord(failure.current)
            setDraft(key, {
              ...draft,
              base: failure.current ? structuredClone(failure.current) : undefined
            })
          }
          throw failure
        }
      })
      if (success && saved) {
        setDraft(key)
        notify('本地资料已保存，源数据未修改。')
        return true
      }
      return false
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      return false
    }
  }
  useEffect(() => {
    saveDraft.current = save
    return () => {
      saveDraft.current = null
    }
  })
  const row = (field: string, label: string, kind: string) => (
    <div className="editor-field" key={field}>
      <label className="field">
        {label}
        {kind === 'gender' ? (
          <select value={draft.values[field]} onChange={event => update(field, event.target.value)}>
            <option value="?">未知</option>
            <option value="f">女</option>
            <option value="m">男</option>
          </select>
        ) : kind === 'note' ? (
          <textarea
            rows={4}
            value={draft.values[field] || ''}
            onChange={event => update(field, event.target.value)}
          />
        ) : (
          <input
            type={kind === 'date' ? 'date' : 'text'}
            inputMode={kind === 'number' ? 'decimal' : undefined}
            value={draft.values[field] || ''}
            onChange={event => update(field, event.target.value)}
          />
        )}
      </label>
      <div className="small muted">
        来源：{display((person as unknown as Record<string, unknown>)[field])}
      </div>
      <div className="field-actions">
        <button type="button" className="text-button" onClick={() => update(field, '', 'clear')}>
          恢复来源
        </button>
        <button type="button" className="text-button" onClick={() => update(field, '', 'unknown')}>
          设为未知
        </button>
        {draft.modes[field] !== 'keep' && (
          <span className="badge">{draft.modes[field] === 'clear' ? '待恢复来源' : '待保存'}</span>
        )}
      </div>
    </div>
  )
  return (
    <form
      className="person-editor"
      onSubmit={event => {
        event.preventDefault()
        save()
      }}
      onKeyDown={event => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
          event.preventDefault()
          save()
        }
      }}
    >
      <h2>修改本地资料</h2>
      <p className="muted">只保存你的覆盖值；原始资料、来源 ID 和采集依据保持不变。</p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {conflicts.length > 0 && (
        <div className="notice">
          其他标签页更新了以下字段，草稿已保留：
          {conflicts.map(field => (
            <p key={field}>
              {fields.find(x => x.key === field)?.label || field}：其他标签页「
              {display(conflictingRecord?.fields[field]?.value)}」 / 我的草稿「{draft.values[field]}
              」
            </p>
          ))}
          <button type="button" onClick={() => save(true)}>
            确认以草稿覆盖这些字段
          </button>
        </div>
      )}
      <div className="editor-grid">
        {fields.map(field => row(field.key, field.label, field.kind))}
      </div>
      {row('personalTags', '个人标签（逗号分隔）', 'text')}
      {row('note', '我的备注（纯文本）', 'note')}
      <h3>自定义字段</h3>
      {Object.keys(draft.modes)
        .filter(field => field.startsWith('custom:'))
        .map(field => row(field, field.slice(7), 'text'))}
      <div className="inline-form">
        <input
          aria-label="自定义字段名"
          value={customName}
          placeholder="例如：待核对事项"
          maxLength={80}
          onChange={event => setCustomName(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            if (customName.trim()) {
              update(`custom:${customName.trim()}`, '')
              setCustomName('')
            }
          }}
        >
          添加字段
        </button>
      </div>
      <footer className="sticky-actions">
        <button
          type="button"
          onClick={() => {
            if (!draft.dirty || window.confirm('放弃这次尚未保存的修改？')) setDraft(key)
          }}
        >
          取消
        </button>
        <button className="primary" type="submit" disabled={conflicts.length > 0}>
          保存本地资料
        </button>
      </footer>
    </form>
  )
}
