/**
 * @file 个人资料的唯一写入口。收藏、覆盖、备注与标签均存同一个版本化 localStorage 键。
 * set(null) 是主动设为未知；clear 是恢复来源的删除标记；两者不能互换。
 * clear 标记会参加导入冲突比较，避免旧备份悄悄复活已恢复的字段。
 */
import { fields, identity, safeUrl, type Person, type Value } from '../entities/person'
export const USER_KEY = 'jav-atlas:user-data:v1'
export interface Operation {
  kind: 'set' | 'clear'
  value: Value
  base: Value
  updatedAt: number
}
export interface PersonalRecord {
  source: Person['source']
  id: string
  snapshot: { name: string; sourceUrl: string }
  favorite?: { active: boolean; addedAt: number; updatedAt: number }
  fields: Record<string, Operation>
}
export interface UserData {
  schemaVersion: 1
  revision: number
  records: Record<string, PersonalRecord>
}
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}
export const emptyData = (): UserData => ({ schemaVersion: 1, revision: 0, records: {} })
const validField = (key: string) =>
  fields.some(field => field.key === key) ||
  ['note', 'personalTags'].includes(key) ||
  /^custom:.{1,80}$/.test(key)
export const same = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** 备份是不可信输入：验证结构及原生身份，不执行内容，也不把任意字段写入对象原型。 */
export function parseData(raw: string): UserData {
  if (raw.length > 5 * 1024 * 1024) throw Error('导入文件超过 5 MB，请拆分备份。')
  const data = JSON.parse(raw)
  if (
    data?.schemaVersion !== 1 ||
    !data.records ||
    Array.isArray(data.records) ||
    typeof data.records !== 'object'
  )
    throw Error('不支持的个人数据格式；原存储未被覆盖。')
  const result = emptyData()
  result.revision = Number.isSafeInteger(data.revision) ? data.revision : 0
  for (const [key, rawRecord] of Object.entries(data.records)) {
    const r = rawRecord as PersonalRecord
    if (
      !['minnano', 'javdb'].includes(r.source) ||
      !/^[a-zA-Z0-9_-]+$/.test(r.id) ||
      key !== identity(r)
    )
      throw Error('备份包含非法来源或 ID。')
    const record: PersonalRecord = {
      source: r.source,
      id: r.id,
      snapshot: {
        name: String(r.snapshot?.name || r.id),
        sourceUrl: String(r.snapshot?.sourceUrl || '')
      },
      fields: {}
    }
    if (r.favorite) {
      if (typeof r.favorite.active !== 'boolean') throw Error('收藏状态格式错误。')
      record.favorite = {
        active: r.favorite.active,
        addedAt: Number(r.favorite.addedAt) || 0,
        updatedAt: Number(r.favorite.updatedAt) || 0
      }
    }
    for (const [field, op] of Object.entries(r.fields || {})) {
      if (
        !validField(field) ||
        !['set', 'clear'].includes(op.kind) ||
        !isValue(op.value) ||
        !isValue(op.base)
      )
        throw Error('备份包含无法识别的个人字段。')
      if (
        field === 'official' &&
        op.kind === 'set' &&
        op.value &&
        !/^https?:\/\//i.test(String(op.value))
      )
        throw Error('官网只能使用 http/https 链接。')
      validateValue(field, op)
      record.fields[field] = {
        kind: op.kind,
        value: op.value,
        base: op.base,
        updatedAt: Number(op.updatedAt) || 0
      }
    }
    result.records[key] = record
  }
  return result
}
function isValue(value: unknown): value is Value {
  return (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(x => typeof x === 'string'))
  )
}
/** 导入也必须遵守编辑器的类型约束，否则数字字段被写成数组后会使筛选口径失真。 */
function validateValue(key: string, op: Operation) {
  if (op.kind === 'clear' || op.value === null) return
  const field = fields.find(field => field.key === key),
    value = op.value
  if (field?.kind === 'number') {
    if (typeof value !== 'number' || value <= 0 || value > 400)
      throw Error('备份中的尺寸数值无效。')
    return
  }
  if (field?.kind === 'aliases' || key === 'personalTags') {
    if (!Array.isArray(value)) throw Error('别名和个人标签必须是文本数组。')
    return
  }
  if (typeof value !== 'string') throw Error('备份中的文本字段类型无效。')
  if (field?.kind === 'url' && value && !safeUrl(value))
    throw Error('官网只能使用 http/https 链接。')
  if (
    field?.kind === 'date' &&
    value &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    throw Error('备份中的生日无效。')
  if (field?.kind === 'gender' && !['f', 'm', '?'].includes(value))
    throw Error('备份中的性别值无效。')
}
export class PersonalConflict extends Error {
  constructor(
    public current: PersonalRecord | undefined,
    public conflicts: string[]
  ) {
    super(`其他标签页已修改这些字段：${conflicts.join('、')}。请核对后重新保存。`)
  }
}
/** 同步写入原子性只覆盖一个存储键，并非跨标签页事务；真正同时写仍可能竞争。 */
export class PersonalRepository {
  constructor(private storage: StorageLike) {}
  read(): UserData {
    const raw = this.storage.getItem(USER_KEY)
    return raw ? parseData(raw) : emptyData()
  }
  raw() {
    return this.storage.getItem(USER_KEY) || JSON.stringify(emptyData())
  }
  private write(data: UserData) {
    data.revision++
    this.storage.setItem(USER_KEY, JSON.stringify(data))
    return data
  }
  patch(
    person: Pick<Person, 'source' | 'id' | 'name' | 'sourceUrl'>,
    changes: Record<string, Operation>,
    expected: Record<string, Operation | undefined>
  ) {
    // expected 是打开表单时的字段版本。重新读取存储后比较，避免覆盖另一页的新修改。
    // 只比较本次 changes，别人在无关字段上的修改不会阻止本次保存。
    const data = this.read(),
      key = identity(person),
      previous = data.records[key]
    const conflicts = Object.keys(changes).filter(
      field => !same(previous?.fields[field], expected[field])
    )
    if (conflicts.length) throw new PersonalConflict(previous, conflicts)
    const record = previous || {
      source: person.source,
      id: person.id,
      snapshot: { name: person.name, sourceUrl: person.sourceUrl },
      fields: {}
    }
    // 仅写实际改动字段。绝不能把旧表单快照中的收藏等无关属性写回来。
    record.fields = { ...record.fields, ...changes }
    data.records[key] = record
    return this.write(data)
  }
  favorite(person: Pick<Person, 'source' | 'id' | 'name' | 'sourceUrl'>, active: boolean) {
    const data = this.read(),
      key = identity(person)
    const r = data.records[key] || {
      source: person.source,
      id: person.id,
      snapshot: { name: person.name, sourceUrl: person.sourceUrl },
      fields: {}
    }
    r.favorite = {
      active,
      addedAt: active ? Date.now() : r.favorite?.addedAt || Date.now(),
      updatedAt: Date.now()
    }
    data.records[key] = r
    return this.write(data)
  }
  /** 导入先预览，确认后比较整个版本；预览期间有其他写入就重新预览，不能静默覆盖。 */
  import(incoming: UserData, choices: Record<string, boolean>, expectedRaw: string) {
    if (this.raw() !== expectedRaw) throw Error('预览后本地数据已变化，请重新导入预览。')
    const data = this.read()
    for (const [key, record] of Object.entries(incoming.records)) {
      const current = data.records[key]
      if (!current) {
        data.records[key] = record
        continue
      }
      if (record.favorite && (!current.favorite || choices[`${key}/favorite`]))
        current.favorite = record.favorite
      for (const [field, op] of Object.entries(record.fields))
        if (!current.fields[field] || choices[`${key}/${field}`]) current.fields[field] = op
    }
    return this.write(data)
  }
  reset() {
    const data = emptyData()
    data.revision = this.read().revision
    return this.write(data)
  }
  /** 标签操作仅涉及个人标签数组；移除后保留空数组状态，旧备份导入仍会产生冲突。 */
  renameTag(from: string, to: string) {
    const data = this.read()
    for (const record of Object.values(data.records)) {
      const op = record.fields.personalTags
      if (op?.kind === 'set' && Array.isArray(op.value) && op.value.includes(from))
        record.fields.personalTags = {
          kind: 'set',
          value: [...new Set(op.value.flatMap(tag => (tag === from ? (to ? [to] : []) : [tag])))],
          base: null,
          updatedAt: Date.now()
        }
    }
    return this.write(data)
  }
}
/** 合成是纯函数：输入来源对象永远不变，原始资料面板仍能查看真正的来源值。 */
export function resolvePerson(source: Person, record?: PersonalRecord): Person {
  if (
    !record ||
    !Object.entries(record.fields).some(
      ([key, op]) => op.kind === 'set' && fields.some(field => field.key === key)
    )
  )
    return source
  const output = { ...source }
  for (const [key, op] of Object.entries(record?.fields || {}))
    if (op.kind === 'set' && fields.some(field => field.key === key)) {
      // 存储保留显式 null 的语义；展示模型恢复固定类型，避免名称为 null 导致搜索崩溃。
      const field = fields.find(field => field.key === key)!
      const empty =
        field.kind === 'number'
          ? null
          : field.kind === 'aliases'
            ? []
            : key === 'gender'
              ? '?'
              : key === 'name'
                ? '未命名（本地未知）'
                : ''
      Object.assign(output, { [key]: op.value === null ? empty : op.value })
    }
  return output
}
export function localValue(record: PersonalRecord | undefined, key: string): Value {
  const op = record?.fields[key]
  return op?.kind === 'set' ? op.value : null
}
