/**
 * @file 纯受控筛选表单。父页面决定立即应用还是作为手机抽屉草稿，因此不会出现两套匹配规则。
 * 区间先校验再提交；输入中的临时非法值不会污染 URL 或清空原有结果。
 */
import { useEffect, useMemo, useState } from 'react'
import type { Person } from '../../entities/person'
import type { UserData } from '../../data/personal'
import { ranges, selectPeople, type PrivateFilters } from './query'
export function Filters({
  people,
  params,
  change,
  personal,
  changePersonal,
  data,
  favoritesOnly
}: {
  people: Person[]
  params: URLSearchParams
  change: (params: URLSearchParams) => void
  personal: PrivateFilters
  changePersonal: (value: PrivateFilters) => void
  data: UserData
  favoritesOnly: boolean
}) {
  const [advanced, setAdvanced] = useState(false)
  const [optionSearch, setOptionSearch] = useState<Record<string, string>>({})
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    next.delete(key)
    if (value) next.set(key, value)
    change(next)
  }
  const toggle = (key: string, value: string) => {
    const values = params.getAll(key),
      next = new URLSearchParams(params)
    next.delete(key)
    for (const item of values.includes(value)
      ? values.filter(x => x !== value)
      : [...values, value])
      next.append(key, item)
    if (next.toString() !== params.toString()) change(next)
  }
  const counts = useMemo(() => {
    const result: Record<string, Map<string, number>> = {}
    for (const field of ['gender', 'cup', 'blood', 'place', 'agency', 'status'] as const) {
      const other = new URLSearchParams(params)
      other.delete(field)
      const map = new Map<string, number>()
      for (const p of selectPeople(people, other, personal, data, favoritesOnly, false)) {
        const value = String(p[field] || 'unknown')
        map.set(value, (map.get(value) || 0) + 1)
      }
      result[field] = map
    }
    return result
  }, [people, params.toString(), personal, data, favoritesOnly])
  const labels: Record<string, string> = {
    f: '女',
    m: '男',
    '?': '未知',
    unknown: '未知',
    raw: '原字段已采集',
    api: 'API 资料',
    profile: '详情已采集',
    directory: '目录记录'
  }
  const choices = (field: keyof typeof counts, title: string, checkbox = false) => {
    const base =
      field === 'gender'
        ? ['f', 'm', '?']
        : field === 'status'
          ? ['directory', 'profile', 'raw', 'api']
          : []
    const values = [
      ...new Set([
        ...base,
        ...people.map(p => String(p[field as keyof Person] || 'unknown')),
        ...params.getAll(field)
      ])
    ].sort()
    return (
      <fieldset>
        <legend>{title}</legend>
        {checkbox ? (
          values.map(value => (
            <label className="check" key={value}>
              <input
                type="checkbox"
                checked={params.getAll(field).includes(value)}
                onChange={() => toggle(field, value)}
                disabled={!counts[field]?.get(value) && !params.getAll(field).includes(value)}
              />
              {labels[value] || value}
              <span className="muted">{counts[field]?.get(value) || 0}</span>
            </label>
          ))
        ) : (
          <>
            {values.length > 12 && (
              <input
                aria-label={`搜索${title}选项`}
                placeholder={`搜索${title}`}
                value={optionSearch[field] || ''}
                onChange={event =>
                  setOptionSearch({ ...optionSearch, [field]: event.target.value })
                }
              />
            )}
            <select
              aria-label={title}
              value=""
              onChange={event => {
                if (event.target.value) toggle(field, event.target.value)
              }}
            >
              <option value="">添加条件…</option>
              {values
                .filter(value =>
                  value
                    .toLocaleLowerCase()
                    .includes((optionSearch[field] || '').toLocaleLowerCase())
                )
                .map(value => (
                  <option
                    key={value}
                    value={value}
                    disabled={params.getAll(field).includes(value) || !counts[field]?.get(value)}
                  >
                    {labels[value] || value} ({counts[field]?.get(value) || 0})
                  </option>
                ))}
            </select>
            {params.getAll(field).map(value => (
              <button className="chip" key={value} onClick={() => toggle(field, value)}>
                {labels[value] || value} ×
              </button>
            ))}
          </>
        )}
      </fieldset>
    )
  }
  const tags = useMemo(
    () => [...new Map(people.flatMap(p => p.tags).map(tag => [tag.value, tag])).values()],
    [people]
  )
  const [tagSearch, setTagSearch] = useState('')
  const privateTags = [
    ...new Set(
      Object.values(data.records).flatMap(record => {
        const value = record.fields.personalTags
        return value?.kind === 'set' && Array.isArray(value.value) ? value.value : []
      })
    )
  ].sort()
  return (
    <div className="filters-body">
      {!favoritesOnly && (
        <label className="field">
          收藏状态
          <select
            value={personal.favorite}
            onChange={event => changePersonal({ ...personal, favorite: event.target.value })}
          >
            <option value="">不限</option>
            <option value="yes">已收藏</option>
            <option value="no">未收藏</option>
          </select>
        </label>
      )}
      {choices('gender', '性别', true)}
      <RangeFilter field="height" title="身高 / cm" params={params} change={change} />
      {choices('cup', '罩杯')}
      <label className="field">
        头像
        <select
          value={params.get('avatar') || ''}
          onChange={event => update('avatar', event.target.value)}
        >
          <option value="">不限</option>
          <option value="yes">有本地头像</option>
          <option value="no">缺头像</option>
        </select>
      </label>
      {choices('status', '资料阶段', true)}
      <button
        className="text-button"
        aria-expanded={advanced}
        onClick={() => setAdvanced(value => !value)}
      >
        {advanced ? '收起高级条件' : '展开高级条件'} {advanced ? '⌃' : '⌄'}
      </button>
      {advanced && (
        <>
          {ranges
            .filter(x => x.key !== 'height')
            .map(range => (
              <RangeFilter
                key={range.key}
                field={range.key}
                title={range.label}
                params={params}
                change={change}
              />
            ))}
          {choices('blood', '血型')}
          {choices('place', '出生地')}
          {choices('agency', '事务所')}
          <fieldset>
            <legend>来源标签</legend>
            <input
              aria-label="搜索来源标签"
              placeholder="搜索标签"
              value={tagSearch}
              onChange={event => setTagSearch(event.target.value)}
            />
            <select
              aria-label="添加来源标签"
              value=""
              onChange={event => event.target.value && toggle('tag', event.target.value)}
            >
              <option value="">选择标签…</option>
              {tags
                .filter(tag => tag.label.includes(tagSearch))
                .map(tag => (
                  <option
                    key={tag.value}
                    value={tag.value}
                    disabled={params.getAll('tag').includes(tag.value)}
                  >
                    {tag.label} · {tag.value.split(':')[0]}
                  </option>
                ))}
            </select>
            {params.getAll('tag').map(value => (
              <button className="chip" key={value} onClick={() => toggle('tag', value)}>
                {tags.find(x => x.value === value)?.label || value} ×
              </button>
            ))}
            <select
              aria-label="标签匹配模式"
              value={params.get('tagMode') || 'any'}
              onChange={event => update('tagMode', event.target.value)}
            >
              <option value="any">匹配任一标签</option>
              <option value="all">匹配全部标签</option>
            </select>
          </fieldset>
          <fieldset>
            <legend>个人标签（不进入分享链接）</legend>
            {privateTags.length ? (
              privateTags.map(tag => (
                <label className="check" key={tag}>
                  <input
                    type="checkbox"
                    checked={personal.personalTags.includes(tag)}
                    onChange={() =>
                      changePersonal({
                        ...personal,
                        personalTags: personal.personalTags.includes(tag)
                          ? personal.personalTags.filter(x => x !== tag)
                          : [...personal.personalTags, tag]
                      })
                    }
                  />
                  {tag}
                </label>
              ))
            ) : (
              <p className="small muted">可在人物本地资料中添加标签。</p>
            )}
          </fieldset>
          <label className="field">
            本地修改
            <select
              value={personal.edited}
              onChange={event => changePersonal({ ...personal, edited: event.target.value })}
            >
              <option value="">不限</option>
              <option value="yes">有本地修改</option>
              <option value="no">无本地修改</option>
            </select>
          </label>
        </>
      )}
    </div>
  )
}
function RangeFilter({
  field,
  title,
  params,
  change
}: {
  field: string
  title: string
  params: URLSearchParams
  change: (p: URLSearchParams) => void
}) {
  const [min, setMin] = useState(params.get(`${field}Min`) || ''),
    [max, setMax] = useState(params.get(`${field}Max`) || '')
  const [error, setError] = useState('')
  useEffect(() => {
    setMin(params.get(`${field}Min`) || '')
    setMax(params.get(`${field}Max`) || '')
    setError('')
  }, [params.get(`${field}Min`), params.get(`${field}Max`)])
  const submit = () => {
    if (
      [min, max].some(x => x && (!Number.isFinite(Number(x)) || Number(x) < 0)) ||
      (min && max && Number(min) > Number(max))
    ) {
      setError('请输入有效区间，下限不能大于上限。')
      return
    }
    setError('')
    const next = new URLSearchParams(params)
    for (const [key, value] of [
      [`${field}Min`, min],
      [`${field}Max`, max]
    ]) {
      next.delete(key)
      if (value) next.set(key, value)
    }
    if (next.toString() !== params.toString()) change(next)
  }
  return (
    <fieldset
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) submit()
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') submit()
      }}
    >
      <legend>{title}</legend>
      <div className="range">
        <input
          aria-label={`${title}最低`}
          inputMode="decimal"
          placeholder="最低"
          value={min}
          onChange={event => setMin(event.target.value)}
        />
        <span>—</span>
        <input
          aria-label={`${title}最高`}
          inputMode="decimal"
          placeholder="最高"
          value={max}
          onChange={event => setMax(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="error small">
          {error}
        </p>
      )}
      <label className="check small">
        <input
          type="checkbox"
          checked={params.get(`${field}Unknown`) === 'yes'}
          onChange={event => {
            const next = new URLSearchParams(params)
            next.delete(`${field}Unknown`)
            if (event.target.checked) next.set(`${field}Unknown`, 'yes')
            change(next)
          }}
        />
        同时包含未知
      </label>
    </fieldset>
  )
}
