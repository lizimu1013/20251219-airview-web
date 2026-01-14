import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { nanoid } from 'nanoid'
import bcrypt from 'bcryptjs'
import multer from 'multer'

import { authMiddleware, requireRole, signToken } from './auth.js'
import { fromJson, migrate, openDb, toJson } from './db.js'
import { canEditRequest, canReview, canViewRequest, isReviewerLike, isTransitionAllowed } from './logic.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.set('trust proxy', true)
app.use(express.json({ limit: '1mb' }))

const corsOrigin = process.env.CORS_ORIGIN
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin, credentials: true }))
}

const db = openDb()
migrate(db)

const uploadsDir = path.resolve(process.cwd(), 'data', 'uploads')
fs.mkdirSync(uploadsDir, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').slice(0, 8)
      cb(null, `${nanoid()}${ext}`)
    },
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
})

const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || process.env.W3_CLIENT_ID || 'airview_login'
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || process.env.W3_CLIENT_SECRET || 'airview_admin'
const SSO_AUTHORIZE_URL = process.env.SSO_AUTHORIZE_URL || 'https://uniportal.huawei.com/saaslogin1/oauth2/authorize'
const SSO_ACCESS_TOKEN_URL = process.env.SSO_ACCESS_TOKEN_URL || 'https://uniportal.huawei.com/saaslogin1/oauth2/accesstoken'
const SSO_USERINFO_URL = process.env.SSO_USERINFO_URL || 'https://uniportal.huawei.com/saaslogin1/oauth2/userinfo'
const SSO_LOGOUT_URL = process.env.SSO_LOGOUT_URL || 'https://uniportal.huawei.com/saaslogin1/oauth2/logout'
const SSO_SCOPE = process.env.SSO_SCOPE || 'base.profile'
const SSO_STATE_COOKIE = 'urm_sso_state'
const SSO_REDIRECT_URI = 'https://airview.rnd.huawei.com/authorize'
const REDIRECT_URI = 'https://airview.rnd.huawei.com/authorize'
const HUAEI_URI = 'https://airview.rnd.huawei.com'

function nowIso() {
  return new Date().toISOString()
}

function formatDateStamp(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function formatDateKey(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function generateRequestId(db, date = new Date()) {
  const stamp = formatDateStamp(date)
  const row = db
    .prepare(
      "SELECT MAX(CAST(substr(id, 10) AS INTEGER)) AS maxSeq FROM requests WHERE id LIKE ? AND substr(id, 10) GLOB '[0-9]*'",
    )
    .get(`${stamp}_%`)
  const maxSeq = row?.maxSeq != null ? Number(row.maxSeq) : 0
  const nextSeq = Number.isFinite(maxSeq) ? maxSeq + 1 : 1
  return `${stamp}_${String(nextSeq).padStart(3, '0')}`
}

function ensureRequestOptions(type) {
  const insert = db.prepare('INSERT OR IGNORE INTO request_options (id, type, value, createdAt) VALUES (?, ?, ?, ?)')
  const createdAt = nowIso()
  if (type === 'domain') {
    const rows = db
      .prepare(`SELECT DISTINCT domain AS value FROM requests WHERE domain IS NOT NULL AND TRIM(domain) <> ''`)
      .all()
    for (const row of rows) {
      insert.run(nanoid(), 'domain', String(row.value).trim(), createdAt)
    }
    return
  }
  if (type === 'tag') {
    const rows = db.prepare("SELECT tagsJson FROM requests WHERE tagsJson IS NOT NULL AND tagsJson <> ''").all()
    const tags = new Set()
    for (const row of rows) {
      const list = fromJson(row.tagsJson, [])
      if (!Array.isArray(list)) continue
      for (const tag of list) {
        if (typeof tag !== 'string') continue
        const value = tag.trim()
        if (!value) continue
        tags.add(value)
      }
    }
    for (const value of tags) {
      insert.run(nanoid(), 'tag', value, createdAt)
    }
  }
}

function normalizeOptionValue(value) {
  const trimmed = String(value ?? '').trim()
  return trimmed ? trimmed : null
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) return []
  const tags = new Set()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (!trimmed) continue
    tags.add(trimmed)
  }
  return [...tags]
}

function upsertRequestOption(type, value) {
  const normalized = normalizeOptionValue(value)
  if (!normalized) return
  const exists = db.prepare('SELECT id FROM request_options WHERE type = ? AND value = ?').get(type, normalized)
  if (exists) return
  db.prepare('INSERT INTO request_options (id, type, value, createdAt) VALUES (?, ?, ?, ?)').run(
    nanoid(),
    type,
    normalized,
    nowIso(),
  )
}

function updateRequestsForOptionChange(type, fromValue, toValue) {
  if (!fromValue || !toValue || fromValue === toValue) return
  if (type === 'domain') {
    db.prepare('UPDATE requests SET domain = ? WHERE domain = ?').run(toValue, fromValue)
    return
  }
  if (type !== 'tag') return
  const escaped = String(fromValue).replaceAll('"', '')
  const rows = db.prepare('SELECT id, tagsJson FROM requests WHERE tagsJson LIKE ?').all(`%\"${escaped}\"%`)
  for (const row of rows) {
    const list = fromJson(row.tagsJson, [])
    if (!Array.isArray(list)) continue
    let changed = false
    const updated = list.map((tag) => {
      if (tag === fromValue) {
        changed = true
        return toValue
      }
      return tag
    })
    if (!changed) continue
    const normalized = normalizeTagList(updated)
    db.prepare('UPDATE requests SET tagsJson = ? WHERE id = ?').run(JSON.stringify(normalized), row.id)
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return value
  return []
}

function parseCookies(header) {
  if (!header) return {}
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=')
    if (!rawKey) return acc
    acc[rawKey] = decodeURIComponent(rest.join('=') || '')
    return acc
  }, {})
}

function setCookie(res, name, value, options) {
  const parts = [`${name}=${value}`]
  if (options?.maxAge != null) parts.push(`Max-Age=${options.maxAge}`)
  if (options?.path) parts.push(`Path=${options.path}`)
  if (options?.httpOnly) parts.push('HttpOnly')
  if (options?.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options?.secure) parts.push('Secure')
  res.setHeader('Set-Cookie', parts.join('; '))
}

function sanitizeRedirectPath(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return raw
}

function buildBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto')
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : req.protocol || 'http'
  const forwardedHost = req.get('x-forwarded-host')
  const host = forwardedHost || req.get('host')
  return `${proto}://${host}`
}

function getPublicBaseUrl(req) {
  const redirectUri = process.env.SSO_REDIRECT_URI
  if (redirectUri) {
    try {
      return new URL(redirectUri).origin
    } catch {
      // fall through to request-derived base
    }
  }
  return buildBaseUrl(req)
}

function getSsoRedirectUri(req) {
  return process.env.SSO_REDIRECT_URI || `${buildBaseUrl(req)}/authorize`
}

function getLogoutRedirectUri(req, redirectTo) {
  const safeRedirect = sanitizeRedirectPath(redirectTo)
  return `${getPublicBaseUrl(req)}${safeRedirect}`
}

function encodeState(payload) {
  return Buffer.from(JSON.stringify(payload)).toString('base64url')
}

function decodeState(state) {
  try {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!data && text && text.includes('=') && text.includes('access_token')) {
    data = Object.fromEntries(new URLSearchParams(text))
  }
  if (!res.ok) {
    const msg = data?.message || data?.error || data?.error_description || text || res.statusText || 'request failed'
    const error = new Error(msg)
    error.status = res.status
    throw error
  }
  return data
}

function buildSsoHtml(token, redirectTo) {
  return `<!doctype html>
<html lang="zh-CN">
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>正在登录...</title>
<body>
  <script>
    try {
      localStorage.setItem('urm_token', ${JSON.stringify(token)});
    } catch (e) {}
    window.location.replace(${JSON.stringify(redirectTo)});
  </script>
  <noscript>登录完成，请返回 <a href="${redirectTo}">${redirectTo}</a></noscript>
</body>
</html>`
}

function rowToRequest(row) {
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    why: row.why,
    acceptanceCriteria: row.acceptanceCriteria ?? undefined,
    status: row.status,
    category: row.category ?? undefined,
    domain: row.domain ?? undefined,
    contactPerson: row.contactPerson ?? undefined,
    deliveryMode: row.deliveryMode ?? undefined,
    priority: row.priority ?? undefined,
    tags: fromJson(row.tagsJson, []),
    links: fromJson(row.linksJson, []),
    impactScope: row.impactScope ?? undefined,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    requesterUsername: row.requesterUsername ?? undefined,
    reviewerId: row.reviewerId ?? undefined,
    reviewerName: row.reviewerName ?? undefined,
    reviewerUsername: row.reviewerUsername ?? undefined,
    implementerId: row.implementerId ?? undefined,
    implementerName: row.implementerName ?? undefined,
    implementerUsername: row.implementerUsername ?? undefined,
    lastActorName: row.lastActorName ?? undefined,
    lastActorUsername: row.lastActorUsername ?? undefined,
    decisionReason: row.decisionReason ?? undefined,
    suspendUntil: row.suspendUntil ?? undefined,
    suspendCondition: row.suspendCondition ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function rowToBoardMessage(row, viewer) {
  if (!row) return null
  const anonymous = Boolean(row.isAnonymous)
  const revealAuthor = !anonymous || viewer?.role === 'admin'
  const canDelete = viewer?.role === 'admin' || (viewer?.id && row.authorId === viewer.id)
  return {
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    anonymous,
    pinned: Boolean(row.isPinned),
    canDelete,
    authorName: revealAuthor ? row.authorName ?? undefined : undefined,
    authorUsername: revealAuthor ? row.authorUsername ?? undefined : undefined,
  }
}

function ensureAdminSeed() {
  const count = db.prepare('SELECT COUNT(1) AS c FROM users').get().c
  if (count > 0) return
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123'
  const t = nowIso()
  const admin = {
    id: nanoid(),
    username: 'admin',
    name: '管理员',
    role: 'admin',
    passwordHash: bcrypt.hashSync(adminPassword, 10),
    createdAt: t,
  }
  db.prepare(
    'INSERT INTO users (id, username, name, role, passwordHash, createdAt) VALUES (@id, @username, @name, @role, @passwordHash, @createdAt)',
  ).run(admin)
  // eslint-disable-next-line no-console
  console.log(`[seed] admin created: username=admin password=${adminPassword}`)
}

ensureAdminSeed()

function getUserById(id) {
  return db.prepare('SELECT id, username, name, role, createdAt FROM users WHERE id = ?').get(id)
}

function getUserByUsername(username) {
  return db.prepare('SELECT id, username, name, role, createdAt FROM users WHERE username = ?').get(username)
}

function getUserAuthByUsername(username) {
  return db
    .prepare('SELECT id, username, name, role, passwordHash, createdAt FROM users WHERE username = ?')
    .get(username)
}

function ensureSsoUser(userinfo) {
  const usernameRaw = userinfo?.uid || userinfo?.email || userinfo?.uuid || ''
  const nameRaw = userinfo?.displayName || userinfo?.name || userinfo?.cn || ''
  const username = String(usernameRaw || '').trim()
  const name = String(nameRaw || '').trim() || username
  if (!username) {
    const err = new Error('missing sso username')
    err.code = 'SSO_USERNAME_MISSING'
    throw err
  }
  const existing = getUserByUsername(username)
  if (existing) {
    if (name && existing.name !== name) {
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, existing.id)
      return { ...existing, name }
    }
    return existing
  }
  const t = nowIso()
  const user = {
    id: nanoid(),
    username,
    name,
    role: 'requester',
    passwordHash: bcrypt.hashSync(nanoid(24), 10),
    createdAt: t,
  }
  try {
    db.prepare(
      'INSERT INTO users (id, username, name, role, passwordHash, createdAt) VALUES (@id, @username, @name, @role, @passwordHash, @createdAt)',
    ).run(user)
  } catch (e) {
    const fallback = getUserByUsername(username)
    if (fallback) return fallback
    throw e
  }
  return { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt }
}

function addAudit({ requestId, actorId, actionType, fromValue, toValue, note }) {
  db.prepare(
    'INSERT INTO audit_logs (id, requestId, actorId, actionType, fromJson, toJson, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(nanoid(), requestId, actorId, actionType, toJson(fromValue), toJson(toValue), note ?? null, nowIso())
}

function normalizeFilename(name) {
  const raw = String(name || '').trim()
  if (!raw) return raw
  const hasCjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(raw)
  if (hasCjk) return raw
  let decoded = ''
  try {
    decoded = Buffer.from(raw, 'latin1').toString('utf8')
  } catch {
    return raw
  }
  if (decoded && /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7a3]/.test(decoded)) return decoded
  return raw
}

function rowToAttachment(row) {
  if (!row) return null
  return {
    id: row.id,
    requestId: row.requestId,
    uploaderId: row.uploaderId,
    uploaderName: row.uploaderName ?? undefined,
    uploaderUsername: row.uploaderUsername ?? undefined,
    filename: normalizeFilename(row.filename),
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt,
    storedPath: row.storedPath,
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ message: 'username/password required' })

  const user = getUserAuthByUsername(String(username))
  if (!user) return res.status(401).json({ message: 'Invalid credentials' })
  const ok = bcrypt.compareSync(String(password), user.passwordHash)
  if (!ok) return res.status(401).json({ message: 'Invalid credentials' })

  const token = signToken({ id: user.id, role: user.role, name: user.name, username: user.username })
  return res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt },
  })
})

app.post('/api/auth/register', (req, res) => {
  const { username, password, name } = req.body || {}
  const uname = String(username || '').trim()
  const pwd = String(password || '')
  const realName = String(name || '').trim()

  if (!uname || !pwd || !realName) return res.status(400).json({ message: 'missing fields' })
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(uname)) return res.status(400).json({ message: '用户名格式不合法' })
  if (pwd.length < 6) return res.status(400).json({ message: '密码长度至少 6 位' })
  if (realName.length < 2) return res.status(400).json({ message: '姓名格式不合法' })

  const t = nowIso()
  const user = {
    id: nanoid(),
    username: uname,
    name: realName,
    role: 'requester',
    passwordHash: bcrypt.hashSync(pwd, 10),
    createdAt: t,
  }

  try {
    db.prepare(
      'INSERT INTO users (id, username, name, role, passwordHash, createdAt) VALUES (@id, @username, @name, @role, @passwordHash, @createdAt)',
    ).run(user)
  } catch (e) {
    return res.status(400).json({ message: '用户名已存在' })
  }

  const token = signToken({ id: user.id, role: user.role, name: user.name, username: user.username })
  return res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt },
  })
})

function redirectToSso(req, res, redirectTo) {
  const safeRedirect = sanitizeRedirectPath(redirectTo)
  const state = encodeState({ nonce: nanoid(), redirect: safeRedirect })
  setCookie(res, SSO_STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: req.protocol === 'https',
    maxAge: 300,
  })
  const params = new URLSearchParams({
    client_id: SSO_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: 'code',
    scope: SSO_SCOPE,
    state,
  })
  return res.redirect(`${SSO_AUTHORIZE_URL}?${params.toString()}`)
}

function redirectSsoError(req, res, reason, redirectTo) {
  const safeRedirect = sanitizeRedirectPath(redirectTo)
  const params = new URLSearchParams({
    sso_error: reason || 'sso_failed',
    redirect: safeRedirect,
  })
  return res.redirect(`/login?${params.toString()}`)
}

app.get('/api/sso/login', (req, res) => redirectToSso(req, res, req.query.redirect))

app.get('/api/sso/logout', (req, res) => {
  const redirectPath = typeof req.query.redirect === 'string' ? req.query.redirect : '/login?manual=1'
  const redirectUri = HUAEI_URI
  const params = new URLSearchParams({ clientId: SSO_CLIENT_ID, redirect: redirectUri })
  return res.redirect(`${SSO_LOGOUT_URL}?${params.toString()}`)
})

app.get('/authorize', async (req, res) => {
  if (req.query.error) return redirectSsoError(req, res, String(req.query.error), req.query.redirect)

  const code = typeof req.query.code === 'string' ? req.query.code : ''
  if (!code) return redirectToSso(req, res, req.query.redirect)

  const state = typeof req.query.state === 'string' ? req.query.state : ''
  const cookies = parseCookies(req.headers.cookie || '')
  const cookieState = cookies[SSO_STATE_COOKIE]
  const statePayload = state ? decodeState(state) : null
  const redirectTo = sanitizeRedirectPath(statePayload?.redirect)

  if (!state || !cookieState || cookieState !== state) {
    return redirectSsoError(req, res, 'state_mismatch', redirectTo)
  }

  setCookie(res, SSO_STATE_COOKIE, '', {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: req.protocol === 'https',
    maxAge: 0,
  })

  try {
    const token = await postJson(SSO_ACCESS_TOKEN_URL, {
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code,
    })
    if (!token?.access_token) {
      // eslint-disable-next-line no-console
      console.error('SSO token response missing access_token', token)
      return redirectSsoError(req, res, 'token_missing', redirectTo)
    }

    const userinfo = await postJson(SSO_USERINFO_URL, {
      client_id: SSO_CLIENT_ID,
      access_token: token.access_token,
      scope: SSO_SCOPE,
    })
    const user = ensureSsoUser(userinfo)
    const jwtToken = signToken({ id: user.id, role: user.role, name: user.name, username: user.username })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.send(buildSsoHtml(jwtToken, redirectTo))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err)
    return redirectSsoError(req, res, 'token_exchange_failed', redirectTo)
  }
})

app.get('/api/me', authMiddleware, (req, res) => {
  const u = getUserById(req.user.id)
  if (!u) return res.status(401).json({ message: 'Unauthorized' })
  return res.json({ user: u })
})

app.get('/api/users', authMiddleware, requireRole(['admin']), (_req, res) => {
  const users = db.prepare('SELECT id, username, name, role, createdAt FROM users ORDER BY createdAt DESC').all()
  return res.json({ users })
})

app.get('/api/users/options', authMiddleware, requireRole(['reviewer', 'admin']), (_req, res) => {
  const users = db.prepare('SELECT id, username, name, role FROM users ORDER BY createdAt DESC').all()
  return res.json({ users })
})

app.get('/api/requests/options', authMiddleware, (_req, res) => {
  ensureRequestOptions('domain')
  ensureRequestOptions('tag')
  const domains = db
    .prepare(`SELECT value FROM request_options WHERE type = 'domain' ORDER BY value ASC`)
    .all()
    .map((row) => row.value)
  const tags = db
    .prepare(`SELECT value FROM request_options WHERE type = 'tag' ORDER BY value ASC`)
    .all()
    .map((row) => row.value)
  return res.json({ domains, tags })
})

app.get('/api/admin/request-options', authMiddleware, requireRole(['admin']), (req, res) => {
  const type = String(req.query.type || '').trim()
  if (!['domain', 'tag'].includes(type)) return res.status(400).json({ message: 'invalid type' })
  ensureRequestOptions(type)
  const options = db
    .prepare('SELECT id, type, value, createdAt FROM request_options WHERE type = ? ORDER BY value ASC')
    .all(type)
  return res.json({ options })
})

app.post('/api/admin/request-options', authMiddleware, requireRole(['admin']), (req, res) => {
  const type = String(req.body?.type || '').trim()
  const value = String(req.body?.value || '').trim()
  if (!['domain', 'tag'].includes(type)) return res.status(400).json({ message: 'invalid type' })
  if (!value) return res.status(400).json({ message: 'value required' })
  const exists = db.prepare('SELECT id FROM request_options WHERE type = ? AND value = ?').get(type, value)
  if (exists) return res.status(400).json({ message: 'value exists' })
  const option = { id: nanoid(), type, value, createdAt: nowIso() }
  db.prepare('INSERT INTO request_options (id, type, value, createdAt) VALUES (@id, @type, @value, @createdAt)').run(option)
  return res.json({ option })
})

app.patch('/api/admin/request-options/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  const id = req.params.id
  const row = db.prepare('SELECT id, type, value FROM request_options WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const value = normalizeOptionValue(req.body?.value)
  if (!value) return res.status(400).json({ message: 'value required' })
  const exists = db
    .prepare('SELECT id FROM request_options WHERE type = ? AND value = ? AND id <> ?')
    .get(row.type, value, id)
  if (exists) return res.status(400).json({ message: 'value exists' })
  db.prepare('UPDATE request_options SET value = ? WHERE id = ?').run(value, id)
  updateRequestsForOptionChange(row.type, row.value, value)
  return res.json({ ok: true })
})

app.delete('/api/admin/request-options/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  const id = req.params.id
  db.prepare('DELETE FROM request_options WHERE id = ?').run(id)
  return res.json({ ok: true })
})

app.post('/api/users', authMiddleware, requireRole(['admin']), (req, res) => {
  const { username, name, role, password } = req.body || {}
  if (!username || !name || !role || !password) return res.status(400).json({ message: 'missing fields' })
  if (!['requester', 'reviewer', 'admin'].includes(role)) return res.status(400).json({ message: 'invalid role' })
  if (String(password).length < 6) return res.status(400).json({ message: 'password too short' })

  const t = nowIso()
  const user = {
    id: nanoid(),
    username: String(username),
    name: String(name),
    role: String(role),
    passwordHash: bcrypt.hashSync(String(password), 10),
    createdAt: t,
  }
  try {
    db.prepare(
      'INSERT INTO users (id, username, name, role, passwordHash, createdAt) VALUES (@id, @username, @name, @role, @passwordHash, @createdAt)',
    ).run(user)
  } catch (e) {
    return res.status(400).json({ message: 'username already exists' })
  }
  return res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role, createdAt: user.createdAt } })
})

app.patch('/api/users/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  const id = req.params.id
  const { name, role, password } = req.body || {}
  const u = getUserById(id)
  if (!u) return res.status(404).json({ message: 'not found' })
  if (role && !['requester', 'reviewer', 'admin'].includes(role)) return res.status(400).json({ message: 'invalid role' })

  const updates = []
  const params = { id }
  if (name != null) {
    updates.push('name=@name')
    params.name = String(name)
  }
  if (role != null) {
    updates.push('role=@role')
    params.role = String(role)
  }
  if (password != null) {
    if (String(password).length < 6) return res.status(400).json({ message: 'password too short' })
    updates.push('passwordHash=@passwordHash')
    params.passwordHash = bcrypt.hashSync(String(password), 10)
  }
  if (!updates.length) return res.json({ user: u })

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id=@id`).run(params)
  return res.json({ user: getUserById(id) })
})

app.get('/api/dashboard/summary', authMiddleware, (req, res) => {
  const user = req.user
  void user
  const rows = db.prepare(`SELECT status, COUNT(1) as c FROM requests GROUP BY status`).all()
  const counts = { total: 0, Submitted: 0, NeedInfo: 0, Accepted: 0, Suspended: 0, Rejected: 0, Closed: 0 }
  for (const r of rows) {
    counts[r.status] = r.c
    counts.total += r.c
  }
  return res.json({ counts })
})

app.get('/api/dashboard/trend', authMiddleware, (req, res) => {
  const daysRaw = Number(req.query.days ?? 14)
  const days = Math.min(90, Math.max(7, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 14))

  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const startIso = start.toISOString()

  const createdRows = db
    .prepare(
      `SELECT substr(createdAt, 1, 10) as d, COUNT(1) as c
       FROM requests
       WHERE createdAt >= ?
       GROUP BY d
       ORDER BY d ASC`,
    )
    .all(startIso)

  const statusRows = db
    .prepare(
      `
      SELECT
        substr(createdAt, 1, 10) as d,
        SUM(CASE WHEN actionType='status_change' AND toJson LIKE '%"status":"Accepted"%' THEN 1 ELSE 0 END) as accepted,
        SUM(CASE WHEN actionType='status_change' AND toJson LIKE '%"status":"Rejected"%' THEN 1 ELSE 0 END) as rejected,
        SUM(CASE WHEN actionType='status_change' AND toJson LIKE '%"status":"Closed"%' THEN 1 ELSE 0 END) as closed
      FROM audit_logs
      WHERE createdAt >= ?
      GROUP BY d
      ORDER BY d ASC
    `,
    )
    .all(startIso)

  const createdMap = new Map(createdRows.map((r) => [r.d, r.c]))
  const statusMap = new Map(
    statusRows.map((r) => [
      r.d,
      {
        accepted: Number(r.accepted) || 0,
        rejected: Number(r.rejected) || 0,
        closed: Number(r.closed) || 0,
      },
    ]),
  )

  const dates = []
  const created = []
  const accepted = []
  const rejected = []
  const closed = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const key = d.toISOString().slice(0, 10)
    const status = statusMap.get(key)
    dates.push(key)
    created.push(createdMap.get(key) ?? 0)
    accepted.push(status?.accepted ?? 0)
    rejected.push(status?.rejected ?? 0)
    closed.push(status?.closed ?? 0)
  }

  return res.json({ dates, created, accepted, rejected, closed })
})

app.get('/api/dashboard/leaderboard', authMiddleware, (req, res) => {
  const daysRaw = Number(req.query.days ?? 0)
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(365, Math.floor(daysRaw)) : 0
  const startIso = days ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString() : null
  const timeFilter = startIso ? 'AND r.createdAt >= @startIso' : ''

  const submitters = db
    .prepare(
      `
      SELECT u.id, u.name, u.username, COUNT(1) AS c
      FROM requests r
      JOIN users u ON u.id = r.requesterId
      WHERE 1=1 ${timeFilter}
      GROUP BY r.requesterId
      ORDER BY c DESC, u.createdAt ASC
      LIMIT 10
    `,
    )
    .all({ startIso })
    .map((row) => ({ userId: row.id, name: row.name, username: row.username, count: row.c }))

  const implementers = db
    .prepare(
      `
      SELECT u.id, u.name, u.username, COUNT(1) AS c
      FROM requests r
      JOIN users u ON u.id = r.implementerId
      WHERE r.implementerId IS NOT NULL
      ${timeFilter}
      GROUP BY r.implementerId
      ORDER BY c DESC, u.createdAt ASC
      LIMIT 10
    `,
    )
    .all({ startIso })
    .map((row) => ({ userId: row.id, name: row.name, username: row.username, count: row.c }))

  return res.json({ submitters, implementers })
})

app.post('/api/track/visit', authMiddleware, (req, res) => {
  const rawPath = String(req.body?.path || '').trim()
  if (!rawPath || !rawPath.startsWith('/')) return res.status(400).json({ message: 'path required' })
  const pathKey = rawPath.split('?')[0].trim()
  const day = formatDateKey()
  const updatedAt = nowIso()
  db.prepare(
    `
    INSERT INTO visit_stats (day, path, count, updatedAt)
    VALUES (@day, @path, 1, @updatedAt)
    ON CONFLICT(day, path)
    DO UPDATE SET count = count + 1, updatedAt = excluded.updatedAt
  `,
  ).run({ day, path: pathKey, updatedAt })
  db.prepare(
    `
    INSERT INTO visit_stats_user (day, path, userId, role, count, updatedAt)
    VALUES (@day, @path, @userId, @role, 1, @updatedAt)
    ON CONFLICT(day, path, userId, role)
    DO UPDATE SET count = count + 1, updatedAt = excluded.updatedAt
  `,
  ).run({ day, path: pathKey, userId: req.user.id, role: req.user.role, updatedAt })
  return res.json({ ok: true })
})

app.get('/api/admin/visits', authMiddleware, requireRole(['admin']), (req, res) => {
  const daysRaw = Number(req.query.days ?? 14)
  const days = Math.min(90, Math.max(1, Number.isFinite(daysRaw) ? Math.floor(daysRaw) : 14))

  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - (days - 1))
  const startKey = formatDateKey(start)
  const endKey = formatDateKey(end)

  const rows = db
    .prepare(
      `
      SELECT day, SUM(count) AS total
      FROM visit_stats
      WHERE day BETWEEN ? AND ?
      GROUP BY day
      ORDER BY day ASC
    `,
    )
    .all(startKey, endKey)

  const byDate = new Map(rows.map((r) => [r.day, r.total]))
  const dates = []
  const counts = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    const key = formatDateKey(d)
    dates.push(key)
    counts.push(byDate.get(key) ?? 0)
  }

  const pages = db
    .prepare(
      `
      SELECT path, SUM(count) AS total
      FROM visit_stats
      WHERE day BETWEEN ? AND ?
      GROUP BY path
      ORDER BY total DESC
      LIMIT 30
    `,
    )
    .all(startKey, endKey)

  const roles = db
    .prepare(
      `
      SELECT role, SUM(count) AS total
      FROM visit_stats_user
      WHERE day BETWEEN ? AND ?
      GROUP BY role
      ORDER BY total DESC
    `,
    )
    .all(startKey, endKey)

  const users = db
    .prepare(
      `
      SELECT v.userId, u.name, u.username, u.role, SUM(v.count) AS total
      FROM visit_stats_user v
      JOIN users u ON u.id = v.userId
      WHERE v.day BETWEEN ? AND ?
      GROUP BY v.userId, u.name, u.username, u.role
      ORDER BY total DESC
      LIMIT 20
    `,
    )
    .all(startKey, endKey)

  return res.json({
    range: { start: dates[0], end: dates[dates.length - 1], days },
    dates,
    counts,
    pages,
    roles,
    users,
  })
})

app.get('/api/dashboard/messages', authMiddleware, (req, res) => {
  const limitRaw = Number(req.query.limit ?? 20)
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20))
  const rows = db
    .prepare(
      `
      SELECT
        m.*,
        u.name AS authorName,
        u.username AS authorUsername
      FROM board_messages m
      LEFT JOIN users u ON u.id = m.authorId
      ORDER BY m.isPinned DESC, m.createdAt DESC
      LIMIT ?
      `,
    )
    .all(limit)
  const messages = rows.map((row) => rowToBoardMessage(row, req.user))
  return res.json({ messages })
})

app.post('/api/dashboard/messages', authMiddleware, (req, res) => {
  const content = String(req.body?.content || '').trim()
  const anonymous = Boolean(req.body?.anonymous)
  if (!content) return res.status(400).json({ message: 'content required' })
  if (content.length > 500) return res.status(400).json({ message: 'content too long' })

  const message = {
    id: nanoid(),
    content,
    authorId: req.user.id,
    isAnonymous: anonymous ? 1 : 0,
    isPinned: 0,
    createdAt: nowIso(),
  }

  db.prepare(
    'INSERT INTO board_messages (id, content, authorId, isAnonymous, isPinned, createdAt) VALUES (@id, @content, @authorId, @isAnonymous, @isPinned, @createdAt)',
  ).run(message)

  const row = db
    .prepare(
      `
      SELECT
        m.*,
        u.name AS authorName,
        u.username AS authorUsername
      FROM board_messages m
      LEFT JOIN users u ON u.id = m.authorId
      WHERE m.id = ?
      `,
    )
    .get(message.id)

  return res.json({ message: rowToBoardMessage(row, req.user) })
})

app.patch('/api/dashboard/messages/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  const id = req.params.id
  const pinned = req.body?.pinned
  if (pinned == null) return res.status(400).json({ message: 'pinned required' })
  const value = pinned ? 1 : 0
  const row = db.prepare('SELECT id FROM board_messages WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  db.prepare('UPDATE board_messages SET isPinned = ? WHERE id = ?').run(value, id)

  const updated = db
    .prepare(
      `
      SELECT
        m.*,
        u.name AS authorName,
        u.username AS authorUsername
      FROM board_messages m
      LEFT JOIN users u ON u.id = m.authorId
      WHERE m.id = ?
      `,
    )
    .get(id)
  return res.json({ message: rowToBoardMessage(updated, req.user) })
})

app.delete('/api/dashboard/messages/:id', authMiddleware, (req, res) => {
  const id = req.params.id
  const row = db.prepare('SELECT id, authorId FROM board_messages WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  if (req.user.role !== 'admin' && row.authorId !== req.user.id) return res.status(403).json({ message: 'forbidden' })
  db.prepare('DELETE FROM board_messages WHERE id = ?').run(id)
  return res.json({ ok: true })
})

app.get('/api/requests', authMiddleware, (req, res) => {
  const user = req.user
  const q = String(req.query.q || '').trim()
  const status = String(req.query.status || '').trim()
  const priority = String(req.query.priority || '').trim()
  const category = String(req.query.category || '').trim()
  const tag = String(req.query.tag || '').trim()
  const requesterId = String(req.query.requesterId || '').trim()
  const sortByRaw = String(req.query.sortBy || '').trim()
  const sortOrderRaw = String(req.query.sortOrder || '').trim()
  const page = Math.max(1, Number(req.query.page || 1))
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize || 10)))

  const where = []
  const params = {}

  void user
  if (requesterId) {
    where.push('r.requesterId=@requesterId')
    params.requesterId = requesterId
  }

  if (status) {
    where.push('r.status=@status')
    params.status = status
  }
  if (priority) {
    where.push('r.priority=@priority')
    params.priority = priority
  }
  if (category) {
    where.push('r.category=@category')
    params.category = category
  }
  if (tag) {
    where.push('r.tagsJson LIKE @tagLike')
    params.tagLike = `%\"${tag.replaceAll('"', '')}\"%`
  }
  if (q) {
    where.push('(r.title LIKE @q OR r.description LIKE @q)')
    params.q = `%${q}%`
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const total = db.prepare(`SELECT COUNT(1) AS c FROM requests r ${whereSql}`).get(params).c
  const offset = (page - 1) * pageSize

  const sortMap = {
    domain: 'r.domain',
    title: 'r.title',
    requesterName: 'u1.name',
    implementerName: 'u4.name',
    createdAt: 'r.createdAt',
    lastActorName: 'u3.name',
    updatedAt: 'r.updatedAt',
    priority:
      "CASE r.priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 9 END",
    status:
      "CASE r.status WHEN 'Submitted' THEN 0 WHEN 'NeedInfo' THEN 1 WHEN 'Accepted' THEN 2 WHEN 'Suspended' THEN 3 WHEN 'Rejected' THEN 4 WHEN 'Closed' THEN 5 ELSE 9 END",
    category: 'r.category',
    tags: 'r.tagsJson',
  }
  const sortBy = sortMap[sortByRaw] || 'r.createdAt'
  const sortOrder = sortOrderRaw === 'asc' ? 'ASC' : 'DESC'

  const list = db
    .prepare(
      `
      SELECT
        r.*,
        u1.name AS requesterName,
        u1.username AS requesterUsername,
        u2.name AS reviewerName,
        u2.username AS reviewerUsername,
        u4.name AS implementerName,
        u4.username AS implementerUsername,
        u3.name AS lastActorName,
        u3.username AS lastActorUsername
      FROM requests r
      JOIN users u1 ON u1.id = r.requesterId
      LEFT JOIN users u2 ON u2.id = r.reviewerId
      LEFT JOIN users u4 ON u4.id = r.implementerId
      LEFT JOIN audit_logs llast
        ON llast.requestId = r.id
       AND llast.createdAt = (SELECT MAX(createdAt) FROM audit_logs WHERE requestId = r.id)
      LEFT JOIN users u3 ON u3.id = llast.actorId
      ${whereSql}
      ORDER BY ${sortBy} ${sortOrder}, r.id DESC
      LIMIT @limit OFFSET @offset
    `,
    )
    .all({ ...params, limit: pageSize, offset })
    .map(rowToRequest)

  return res.json({ list, total, page, pageSize })
})

app.post('/api/requests', authMiddleware, (req, res) => {
  const user = req.user
  const body = req.body || {}
  const title = String(body.title || '').trim()
  const description = String(body.description || '')
  const why = String(body.why || '')
  if (!title) return res.status(400).json({ message: 'title required' })

  const domainValue = normalizeOptionValue(body.domain)
  const tagValues = normalizeTagList(body.tags)
  const t = nowIso()
  let requestId = ''
  let row = null
  let inserted = false
  for (let i = 0; i < 3 && !inserted; i += 1) {
    requestId = generateRequestId(db)
    row = {
      id: requestId,
      title,
      description,
      why,
      acceptanceCriteria: body.acceptanceCriteria ? String(body.acceptanceCriteria) : null,
      status: 'Submitted',
      category: body.category ? String(body.category) : null,
      domain: domainValue,
      contactPerson: body.contactPerson ? String(body.contactPerson) : null,
      deliveryMode: body.deliveryMode ? String(body.deliveryMode) : null,
      priority: body.priority ? String(body.priority) : null,
      tagsJson: JSON.stringify(tagValues),
      linksJson: JSON.stringify(jsonArray(body.links)),
      impactScope: body.impactScope ? String(body.impactScope) : null,
      requesterId: user.id,
      reviewerId: null,
      implementerId: null,
      decisionReason: null,
      suspendUntil: null,
      suspendCondition: null,
      createdAt: t,
      updatedAt: t,
    }

    try {
      db.prepare(
        `
        INSERT INTO requests
        (id,title,description,why,acceptanceCriteria,status,category,domain,contactPerson,deliveryMode,priority,tagsJson,linksJson,impactScope,requesterId,reviewerId,implementerId,decisionReason,suspendUntil,suspendCondition,createdAt,updatedAt)
        VALUES
        (@id,@title,@description,@why,@acceptanceCriteria,@status,@category,@domain,@contactPerson,@deliveryMode,@priority,@tagsJson,@linksJson,@impactScope,@requesterId,@reviewerId,@implementerId,@decisionReason,@suspendUntil,@suspendCondition,@createdAt,@updatedAt)
      `,
      ).run(row)
      inserted = true
    } catch (e) {
      const msg = String(e?.message || '')
      if (!msg.includes('requests.id')) throw e
    }
  }
  if (!inserted || !row) return res.status(500).json({ message: 'create failed' })

  upsertRequestOption('domain', domainValue)
  for (const tag of tagValues) upsertRequestOption('tag', tag)
  addAudit({ requestId, actorId: user.id, actionType: 'create', toValue: { status: 'Submitted' } })
  return res.json({ id: requestId })
})

app.get('/api/requests/:id', authMiddleware, (req, res) => {
  const user = req.user
  const id = req.params.id
  const row = db
    .prepare(
      `
      SELECT
        r.*,
        u1.name AS requesterName,
        u1.username AS requesterUsername,
        u2.name AS reviewerName,
        u2.username AS reviewerUsername,
        u3.name AS implementerName,
        u3.username AS implementerUsername
      FROM requests r
      JOIN users u1 ON u1.id = r.requesterId
      LEFT JOIN users u2 ON u2.id = r.reviewerId
      LEFT JOIN users u3 ON u3.id = r.implementerId
      WHERE r.id = ?
    `,
    )
    .get(id)
  const request = rowToRequest(row)
  if (!request) return res.status(404).json({ message: 'not found' })
  if (!canViewRequest(user, request)) return res.status(403).json({ message: 'forbidden' })

  const comments = db
    .prepare(
      `
      SELECT c.*, u.name AS authorName, u.username AS authorUsername
      FROM comments c
      JOIN users u ON u.id = c.authorId
      WHERE c.requestId = ?
      ORDER BY c.createdAt ASC
    `,
    )
    .all(id)
    .map((c) => ({
      id: c.id,
      requestId: c.requestId,
      authorId: c.authorId,
      authorName: c.authorName,
      authorUsername: c.authorUsername,
      content: c.content,
      createdAt: c.createdAt,
    }))

  const auditLogs = db
    .prepare(
      `
      SELECT l.*, u.name AS actorName, u.username AS actorUsername
      FROM audit_logs l
      JOIN users u ON u.id = l.actorId
      WHERE l.requestId = ?
      ORDER BY l.createdAt DESC
    `,
    )
    .all(id)
    .map((l) => ({
      id: l.id,
      requestId: l.requestId,
      actorId: l.actorId,
      actorName: l.actorName,
      actorUsername: l.actorUsername,
      actionType: l.actionType,
      fromValue: fromJson(l.fromJson, null),
      toValue: fromJson(l.toJson, null),
      note: l.note ?? undefined,
      createdAt: l.createdAt,
    }))

  const attachments = db
    .prepare(
      `
      SELECT a.*, u.name AS uploaderName, u.username AS uploaderUsername
      FROM attachments a
      JOIN users u ON u.id = a.uploaderId
      WHERE a.requestId = ?
      ORDER BY a.createdAt DESC
    `,
    )
    .all(id)
    .map((row) => {
      const a = rowToAttachment(row)
      delete a.storedPath
      return a
    })

  return res.json({ request, comments, auditLogs, attachments })
})

app.patch('/api/requests/:id', authMiddleware, (req, res) => {
  const user = req.user
  const id = req.params.id
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const current = rowToRequest({ ...row, requesterName: '', reviewerName: '' })
  if (!canEditRequest(user, current)) return res.status(403).json({ message: 'forbidden' })

  const body = req.body || {}
  const patch = {}
  const domainValue = body.domain !== undefined ? normalizeOptionValue(body.domain) : undefined
  const tagValues = body.tags !== undefined ? normalizeTagList(body.tags) : undefined

  if (body.title != null) patch.title = String(body.title).trim()
  if (body.description != null) patch.description = String(body.description)
  if (body.why != null) patch.why = String(body.why)
  if (body.acceptanceCriteria != null) patch.acceptanceCriteria = String(body.acceptanceCriteria) || null
  if (body.category !== undefined) patch.category = body.category ? String(body.category) : null
  if (body.domain !== undefined) patch.domain = domainValue
  if (body.contactPerson !== undefined) patch.contactPerson = body.contactPerson ? String(body.contactPerson) : null
  if (body.deliveryMode !== undefined) patch.deliveryMode = body.deliveryMode ? String(body.deliveryMode) : null
  if (body.priority !== undefined) patch.priority = body.priority ? String(body.priority) : null
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(tagValues)
  if (body.links !== undefined) patch.linksJson = JSON.stringify(jsonArray(body.links))
  if (body.impactScope !== undefined) patch.impactScope = body.impactScope ? String(body.impactScope) : null
  if (body.implementerId !== undefined) {
    if (!isReviewerLike(user.role)) return res.status(403).json({ message: 'forbidden' })
    const implementerId = String(body.implementerId || '').trim()
    if (implementerId) {
      const implementer = getUserById(implementerId)
      if (!implementer) return res.status(400).json({ message: 'invalid implementerId' })
      patch.implementerId = implementerId
    } else {
      patch.implementerId = null
    }
  }
  if (body.createdAt != null) {
    if (user.role !== 'admin') return res.status(403).json({ message: 'forbidden' })
    const t = new Date(String(body.createdAt))
    if (Number.isNaN(t.getTime())) return res.status(400).json({ message: 'invalid createdAt' })
    patch.createdAt = t.toISOString()
  }

  if (patch.title === '') return res.status(400).json({ message: 'title required' })

  patch.updatedAt = nowIso()

  const fields = Object.keys(patch)
  if (!fields.length) return res.json({ ok: true })

  const setSql = fields.map((f) => `${f}=@${f}`).join(', ')
  db.prepare(`UPDATE requests SET ${setSql} WHERE id=@id`).run({ id, ...patch })
  if (body.domain !== undefined) upsertRequestOption('domain', domainValue)
  if (body.tags !== undefined && Array.isArray(tagValues)) {
    for (const tag of tagValues) upsertRequestOption('tag', tag)
  }
  const note = patch.createdAt ? '编辑需求字段（含提交时间）' : '编辑需求字段'
  addAudit({ requestId: id, actorId: user.id, actionType: 'edit', note, fromValue: { status: current.status }, toValue: { status: current.status } })
  return res.json({ ok: true })
})

app.delete('/api/requests/:id', authMiddleware, requireRole(['admin']), (req, res) => {
  const id = req.params.id
  const row = db.prepare('SELECT id FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })

  const attachments = db.prepare('SELECT storedPath FROM attachments WHERE requestId = ?').all(id)
  db.prepare('DELETE FROM requests WHERE id = ?').run(id)
  for (const att of attachments) {
    if (!att?.storedPath) continue
    try {
      if (fs.existsSync(att.storedPath)) fs.unlinkSync(att.storedPath)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('failed to delete attachment', att.storedPath, e)
    }
  }
  return res.json({ ok: true })
})

app.post('/api/requests/:id/comments', authMiddleware, (req, res) => {
  const user = req.user
  const id = req.params.id
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const current = rowToRequest({ ...row, requesterName: '', reviewerName: '' })
  if (!canViewRequest(user, current)) return res.status(403).json({ message: 'forbidden' })

  const content = String(req.body?.content || '').trim()
  if (!content) return res.status(400).json({ message: 'content required' })
  const t = nowIso()

  db.prepare('INSERT INTO comments (id, requestId, authorId, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(
    nanoid(),
    id,
    user.id,
    content,
    t,
  )
  db.prepare('UPDATE requests SET updatedAt=? WHERE id=?').run(t, id)
  addAudit({ requestId: id, actorId: user.id, actionType: 'comment', note: content })
  return res.json({ ok: true })
})

app.delete('/api/requests/:id/comments/:commentId', authMiddleware, (req, res) => {
  const user = req.user
  const requestId = req.params.id
  const commentId = req.params.commentId

  const requestRow = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId)
  if (!requestRow) return res.status(404).json({ message: 'not found' })
  const request = rowToRequest({ ...requestRow, requesterName: '', reviewerName: '' })
  if (!canViewRequest(user, request)) return res.status(403).json({ message: 'forbidden' })

  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND requestId = ?').get(commentId, requestId)
  if (!comment) return res.status(404).json({ message: 'comment not found' })
  if (comment.authorId !== user.id && user.role !== 'admin') return res.status(403).json({ message: 'forbidden' })

  db.prepare('DELETE FROM comments WHERE id = ?').run(commentId)
  const t = nowIso()
  db.prepare('UPDATE requests SET updatedAt=? WHERE id=?').run(t, requestId)
  addAudit({ requestId, actorId: user.id, actionType: 'comment', note: '删除评论' })
  return res.json({ ok: true })
})

app.post('/api/requests/:id/status', authMiddleware, (req, res) => {
  const user = req.user
  if (!canReview(user)) return res.status(403).json({ message: 'forbidden' })

  const id = req.params.id
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const current = rowToRequest({ ...row, requesterName: '', reviewerName: '' })

  const toStatus = String(req.body?.toStatus || '')
  const reason = String(req.body?.reason || '').trim()
  const suspendUntil = req.body?.suspendUntil ? String(req.body.suspendUntil).trim() : ''
  const suspendCondition = req.body?.suspendCondition ? String(req.body.suspendCondition).trim() : ''
  const implementerIdRaw = req.body?.implementerId ? String(req.body.implementerId).trim() : ''

  if (!toStatus) return res.status(400).json({ message: 'toStatus required' })
  if (!isTransitionAllowed(current.status, toStatus)) return res.status(400).json({ message: 'transition not allowed' })
  if (!reason) return res.status(400).json({ message: 'reason required' })
  if (toStatus === 'Suspended' && !suspendUntil && !suspendCondition) {
    return res.status(400).json({ message: 'Suspended requires suspendUntil or suspendCondition' })
  }
  if (toStatus === 'Accepted') {
    if (!implementerIdRaw) return res.status(400).json({ message: 'implementerId required' })
    const implementer = getUserById(implementerIdRaw)
    if (!implementer) return res.status(400).json({ message: 'invalid implementerId' })
  }

  const t = nowIso()
  const implementerId = toStatus === 'Accepted' ? implementerIdRaw : (current.implementerId ?? null)
  const patch = {
    status: toStatus,
    reviewerId: user.id,
    implementerId,
    decisionReason: reason,
    suspendUntil: toStatus === 'Suspended' ? (suspendUntil || null) : null,
    suspendCondition: toStatus === 'Suspended' ? (suspendCondition || null) : null,
    updatedAt: t,
  }

  db.prepare(
    `
    UPDATE requests
    SET status=@status, reviewerId=@reviewerId, implementerId=@implementerId, decisionReason=@decisionReason, suspendUntil=@suspendUntil, suspendCondition=@suspendCondition, updatedAt=@updatedAt
    WHERE id=@id
  `,
  ).run({ id, ...patch })

  addAudit({
    requestId: id,
    actorId: user.id,
    actionType: 'status_change',
    fromValue: { status: current.status },
    toValue: {
      status: toStatus,
      decisionReason: reason,
      implementerId,
      suspendUntil: patch.suspendUntil,
      suspendCondition: patch.suspendCondition,
    },
    note: reason,
  })

  return res.json({ ok: true })
})

app.post('/api/requests/:id/resubmit', authMiddleware, (req, res) => {
  const user = req.user
  const id = req.params.id
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const current = rowToRequest({ ...row, requesterName: '', reviewerName: '' })

  const note = String(req.body?.note || '重新进入评审').trim()
  const allowed =
    (current.status === 'NeedInfo' && current.requesterId === user.id) ||
    ((current.status === 'Suspended' || current.status === 'Rejected') && isReviewerLike(user.role))
  if (!allowed) return res.status(403).json({ message: 'forbidden' })

  const t = nowIso()
  db.prepare('UPDATE requests SET status=?, updatedAt=? WHERE id=?').run('Submitted', t, id)
  addAudit({ requestId: id, actorId: user.id, actionType: 'status_change', fromValue: { status: current.status }, toValue: { status: 'Submitted' }, note })
  return res.json({ ok: true })
})

app.post('/api/requests/:id/attachments', authMiddleware, upload.single('file'), (req, res) => {
  const user = req.user
  const id = req.params.id
  const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(id)
  if (!row) return res.status(404).json({ message: 'not found' })
  const current = rowToRequest({ ...row, requesterName: '', reviewerName: '' })
  if (!canViewRequest(user, current)) return res.status(403).json({ message: 'forbidden' })

  const file = req.file
  if (!file) return res.status(400).json({ message: 'file required' })

  const originalName = normalizeFilename(file.originalname || file.filename)
  const att = {
    id: nanoid(),
    requestId: id,
    uploaderId: user.id,
    filename: originalName,
    mimeType: file.mimetype || 'application/octet-stream',
    sizeBytes: file.size,
    storedPath: file.path,
    createdAt: nowIso(),
  }
  db.prepare(
    'INSERT INTO attachments (id, requestId, uploaderId, filename, mimeType, sizeBytes, storedPath, createdAt) VALUES (@id, @requestId, @uploaderId, @filename, @mimeType, @sizeBytes, @storedPath, @createdAt)',
  ).run(att)

  const result = {
    id: att.id,
    requestId: att.requestId,
    uploaderId: att.uploaderId,
    uploaderName: user.name,
    uploaderUsername: user.username,
    filename: att.filename,
    mimeType: att.mimeType,
    sizeBytes: att.sizeBytes,
    createdAt: att.createdAt,
  }
  return res.json(result)
})

app.get('/api/attachments/:id/download', authMiddleware, (req, res) => {
  const attId = req.params.id
  const row = db
    .prepare(
      `
      SELECT a.*, r.requesterId, r.reviewerId, r.status
      FROM attachments a
      JOIN requests r ON r.id = a.requestId
      WHERE a.id = ?
    `,
    )
    .get(attId)
  if (!row) return res.status(404).json({ message: 'not found' })
  const attachment = rowToAttachment(row)
  const request = rowToRequest({ ...row, requesterName: '', reviewerName: '' })
  if (!canViewRequest(req.user, request)) return res.status(403).json({ message: 'forbidden' })
  if (!fs.existsSync(attachment.storedPath)) return res.status(410).json({ message: 'file missing' })

  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`)
  const stream = fs.createReadStream(attachment.storedPath)
  stream.pipe(res)
})

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ message: '文件过大，最大 200MB' })
    return res.status(400).json({ message: '文件上传失败' })
  }
  // eslint-disable-next-line no-console
  console.error(err)
  return res.status(500).json({ message: 'server error' })
})

// Serve SPA in production
const distDir = path.resolve(process.cwd(), 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).end()
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

const port = Number(process.env.PORT || 3000)
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`server listening on http://localhost:${port}`)
})
