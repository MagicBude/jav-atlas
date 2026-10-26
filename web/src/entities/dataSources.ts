/**
 * 资料来源注册表：能力说明与链接规则集中维护，页面不再各自拼接源站地址。
 * “已接入”描述本项目实现，不是站点可用性承诺；每条记录仍可能缺少字段。
 * 来源身份独立，不按相同姓名或番号推断两个来源的人物/作品ID。
 */
export const dataSources = [
  {
    id: 'minnano',
    name: 'minnano',
    integration: '人物、榜单与作品资料已接入',
    personFields: ['姓名与别名', '生日、身高与三围', '事务所、爱好与官网', '相关人物与头像'],
    workFields: ['标题与番号', '发行日期与片商', '出演者', '人物作品分页'],
    update: '三榜前250位累积人物池；分批补齐缺失资料和作品。',
    limitations: '来源分页遍历完成不代表全部出演；人物资料目前主要补缺，不保证所有字段每天刷新。'
  },
  {
    id: 'javdb',
    name: 'JavDB',
    integration: '作品补充资料已接入，人物资料为既有存档',
    personFields: ['已有演员目录与来源ID', '已有头像与性别核对记录'],
    workFields: ['评分与评价人数', '时长、导演、片商与系列', '类别与出演者', '部分历史评论样本'],
    update: '已有minnano作品按番号精确匹配后分批补元数据；人物存档目前没有定期刷新。',
    limitations:
      '匹配不唯一时不建立对应；评论仅有部分样本。类别按内容类型和ID区分，不能跨类型合并。'
  }
] as const
export type DataSourceId = (typeof dataSources)[number]['id']
export type SourceEntity = 'person' | 'work'

/** 只有已知来源和有效原生ID才生成详情入口；不从标题、姓名或番号猜测URL。 */
export function sourceRecordUrl(
  source: string,
  entity: SourceEntity,
  id: string
): string | undefined {
  if (typeof id !== 'string' || !id || (entity !== 'person' && entity !== 'work')) return undefined
  if (source === 'minnano' && /^\d+$/.test(id)) {
    return `https://www.minnano-av.com/${entity === 'person' ? 'actress' : 'av'}${id}.html`
  }
  const javdbId = entity === 'person' ? /^[a-zA-Z0-9_-]+$/ : /^[a-zA-Z0-9]+$/
  if (source === 'javdb' && javdbId.test(id)) {
    return `https://javdb.com/${entity === 'person' ? 'actors' : 'v'}/${id}`
  }
  return undefined
}
