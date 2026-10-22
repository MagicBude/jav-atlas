/** 收藏图标共用同一路径，使用SVG避免不同系统的字符爱心外观不一致。按钮负责无障碍名称。 */
export function HeartIcon({ active = false }: { active?: boolean }) {
  return (
    <svg
      className="heart-icon"
      viewBox="0 0 24 24"
      width="21"
      height="21"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  )
}
