import dayjs from 'dayjs'

export function nowIso() {
  return dayjs().toISOString()
}

export function formatDateTime(value?: string) {
  if (!value) return '-'
  return dayjs(value).format('YYYY-MM-DD HH:mm')
}

export function formatDate(value?: string) {
  if (!value) return '-'
  return dayjs(value).format('YYYY-MM-DD')
}

