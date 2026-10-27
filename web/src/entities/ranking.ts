/** 名次差为「上次名次 − 本次名次」：正数上升；进入前250不等于历史首次上榜。 */
export interface RankChange {
  kind: 'up' | 'down' | 'same' | 'entered'
  delta: number | null
}
export function rankChangeLabel(change: RankChange): string {
  if (change.kind === 'entered') return '进入前250'
  if (change.kind === 'same') return '持平'
  return `${change.kind === 'up' ? '↑' : '↓'} ${Math.abs(change.delta || 0)}`
}
