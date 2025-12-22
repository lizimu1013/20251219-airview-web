type UserLike = { name?: string | null; username?: string | null } | null | undefined

export function formatUserLabel(user: UserLike) {
  if (!user) return ''
  const rawName = String(user.name || '').trim()
  const chineseParts = rawName.match(/[\u4e00-\u9fff]+/g)
  const name = chineseParts?.length ? chineseParts.join('') : rawName
  const username = String(user.username || '').trim()
  if (!name) return username
  if (!username) return name
  return `${name}（${username}）`
}
