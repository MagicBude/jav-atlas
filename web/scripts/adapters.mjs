/**
 * @file 来源适配器只做纯数据转换，不读文件、不请求网络、不写输出。
 * 采集模型各不相同，先在这里统一展示字段；页面因此不必反复猜 mnid/id、hip/hips。
 * “统一展示”不是删除原字段：records 中始终保留各来源的完整原对象。
 */
const text = value => (typeof value === 'string' ? value.trim() : '')
const names = value =>
  Array.isArray(value)
    ? value.flatMap(names)
    : text(value)
        .split(/[、,，;；]/)
        .map(x => x.trim())
        .filter(Boolean)
const number = value =>
  value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : null
/**
 * 收集两站的原生人物。JavDB 两集合按原始字符串 ID 对齐，不按同名归并，不转小写。
 * @param {(path:string, fallback?:unknown)=>any} read 由构建入口提供的只读 JSON 读取器。
 * @returns {Record<string, Array<{main:object, records:object}>>} 主视图与完整原记录。
 */
export function collectSources(read) {
  const evidence = read('javdb/web-genders.json', { records: {} }).records
  const map = new Map()
  for (const [kind, list] of [
    ['actors', read('javdb/actors.json', { list: [] }).list],
    ['uncensored', read('javdb/uncensored-actors.json', { list: [] }).list]
  ]) {
    for (const record of list) {
      const id = String(record.id)
      if (!map.has(id)) map.set(id, {})
      map.get(id)[kind] = record
    }
  }
  return {
    minnano: read('minnano/actresses.json', []).map(record => ({
      main: record,
      records: { directory: record }
    })),
    javdb: [...map.entries()].map(([id, records]) => {
      const main = { ...records.uncensored }
      for (const [key, value] of Object.entries(records.actors || {}))
        if (value !== '' && value != null && !(Array.isArray(value) && !value.length))
          main[key] = value
      // 普通集合的“未知”不应该覆盖另一集合已有的明确性别。网页依据单独保留可追溯。
      const genderRecord = [evidence[id], records.actors, records.uncensored].find(
        row => row && ['f', 'm'].includes(row.gender)
      )
      if (genderRecord) {
        main.gender = genderRecord.gender
        main.genderSource =
          genderRecord === evidence[id] ? 'javdb-web-section-meta' : genderRecord.genderSource
      }
      return {
        main: { ...main, id },
        records: { ...records, ...(evidence[id] ? { genderEvidence: evidence[id] } : {}) }
      }
    })
  }
}
/**
 * 投影搜索和列表所需字段。只保留真实数值，无法解析为 null；文本原文仍在详情 records 中。
 * @param {'minnano'|'javdb'} source 原生来源命名空间。
 * @param {object} r 已合成的来源记录；不会修改它。
 * @returns {object} 与页面字段字典一致的展示索引。
 */
export function projectPerson(source, r) {
  return {
    name: r.name,
    aliases: [
      ...new Set([
        ...names(r.alias),
        ...names(r.other_name),
        ...names(r.name_zht),
        ...names(r.mcanon)
      ])
    ],
    gender: source === 'minnano' ? 'f' : ['f', 'm'].includes(r.gender) ? r.gender : '?',
    birthday: text(r.birthday),
    height: number(r.height),
    breast: number(r.breast ?? r.bust),
    waist: number(r.waist),
    hip: number(r.hip ?? r.hips),
    cup: text(r.cup).normalize('NFKC').toUpperCase(),
    blood: text(r.blood ?? r.blood_type),
    place: text(r.place ?? r.birthplace),
    agency: text(r.agency),
    hobby: text(r.hobby),
    shoe: text(r.shoe),
    official: text(r.official)
  }
}
