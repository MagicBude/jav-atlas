/** 字段行统一复用类别栏的三列网格，使搜索选择器与年份、类别的左侧名称对齐。 */
import { SearchSelect, type SearchOption } from '../../shared/SearchSelect'
export function WorkFilterRow({
  label,
  value,
  options,
  onChange
}: {
  label: string
  value: string
  options: SearchOption[]
  onChange: (value: string) => void
}) {
  return (
    <section className="category-row work-field-row" aria-label={label}>
      <h2 className="category-row-label">{label}</h2>
      <div className="work-field-control">
        <SearchSelect
          label={label}
          value={value}
          options={options}
          onChange={onChange}
          showLabel={false}
        />
      </div>
    </section>
  )
}
