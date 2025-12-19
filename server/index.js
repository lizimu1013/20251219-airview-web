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

function nowIso() {
  return new Date().toISOString()
}

function jsonArray(value) {
  if (Array.isArray(value)) return value
  return []
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
    priority: row.priority ?? undefined,
    tags: fromJson(row.tagsJson, []),
    links: fromJson(row.linksJson, []),
    impactScope: row.impactScope ?? undefined,
    requesterId: row.requesterId,
    requesterName: row.requesterName,
    reviewerId: row.reviewerId ?? undefined,
    reviewerName: row.reviewerName ?? undefined,
    decisionReason: row.decisionReason ?? undefined,
    suspendUntil: row.suspendUntil ?? undefined,
    suspendCondition: row.suspendCondition ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

function getUserAuthByUsername(username) {
  return db
    .prepare('SELECT id, username, name, role, passwordHash, createdAt FROM users WHERE username = ?')
    .get(username)
}

function addAudit({ requestId, actorId, actionType, fromValue, toValue, note }) {
  db.prepare(
    'INSERT INTO audit_logs (id, requestId, actorId, actionType, fromJson, toJson, note, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(nanoid(), requestId, actorId, actionType, toJson(fromValue), toJson(toValue), note ?? null, nowIso())
}

function rowToAttachment(row) {
  if (!row) return null
  return {
    id: row.id,
    requestId: row.requestId,
    uploaderId: row.uploaderId,
    uploaderName: row.uploaderName ?? undefined,
    filename: row.filename,
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

  const rows = db
    .prepare(
      `SELECT substr(createdAt, 1, 10) as d, COUNT(1) as c
       FROM requests
       WHERE createdAt >= ?
       GROUP BY d
       ORDER BY d ASC`,
    )
    .all(startIso)

  const byDate = new Map(rows.map((r) => [r.d, r.c]))
  const dates = []
  const counts = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start)
    d.setUTCDate(start.getUTCDate() + i)
    const key = d.toISOString().slice(0, 10)
    dates.push(key)
    counts.push(byDate.get(key) ?? 0)
  }

  return res.json({ dates, counts })
})

app.get('/api/requests', authMiddleware, (req, res) => {
  const user = req.user
  const q = String(req.query.q || '').trim()
  const status = String(req.query.status || '').trim()
  const priority = String(req.query.priority || '').trim()
  const category = String(req.query.category || '').trim()
  const tag = String(req.query.tag || '').trim()
  const requesterId = String(req.query.requesterId || '').trim()
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

  const list = db
    .prepare(
      `
      SELECT
        r.*,
        u1.name AS requesterName,
        u2.name AS reviewerName
      FROM requests r
      JOIN users u1 ON u1.id = r.requesterId
      LEFT JOIN users u2 ON u2.id = r.reviewerId
      ${whereSql}
      ORDER BY r.updatedAt DESC
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
  if (!description.trim()) return res.status(400).json({ message: 'description required' })
  if (!why.trim()) return res.status(400).json({ message: 'why required' })

  const t = nowIso()
  const requestId = nanoid()
  const row = {
    id: requestId,
    title,
    description,
    why,
    acceptanceCriteria: body.acceptanceCriteria ? String(body.acceptanceCriteria) : null,
    status: 'Submitted',
    category: body.category ? String(body.category) : null,
    priority: body.priority ? String(body.priority) : null,
    tagsJson: JSON.stringify(jsonArray(body.tags)),
    linksJson: JSON.stringify(jsonArray(body.links)),
    impactScope: body.impactScope ? String(body.impactScope) : null,
    requesterId: user.id,
    reviewerId: null,
    decisionReason: null,
    suspendUntil: null,
    suspendCondition: null,
    createdAt: t,
    updatedAt: t,
  }

  db.prepare(
    `
    INSERT INTO requests
    (id,title,description,why,acceptanceCriteria,status,category,priority,tagsJson,linksJson,impactScope,requesterId,reviewerId,decisionReason,suspendUntil,suspendCondition,createdAt,updatedAt)
    VALUES
    (@id,@title,@description,@why,@acceptanceCriteria,@status,@category,@priority,@tagsJson,@linksJson,@impactScope,@requesterId,@reviewerId,@decisionReason,@suspendUntil,@suspendCondition,@createdAt,@updatedAt)
  `,
  ).run(row)

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
        u2.name AS reviewerName
      FROM requests r
      JOIN users u1 ON u1.id = r.requesterId
      LEFT JOIN users u2 ON u2.id = r.reviewerId
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
      SELECT c.*, u.name AS authorName
      FROM comments c
      JOIN users u ON u.id = c.authorId
      WHERE c.requestId = ?
      ORDER BY c.createdAt ASC
    `,
    )
    .all(id)
    .map((c) => ({ id: c.id, requestId: c.requestId, authorId: c.authorId, authorName: c.authorName, content: c.content, createdAt: c.createdAt }))

  const auditLogs = db
    .prepare(
      `
      SELECT l.*, u.name AS actorName
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
      actionType: l.actionType,
      fromValue: fromJson(l.fromJson, null),
      toValue: fromJson(l.toJson, null),
      note: l.note ?? undefined,
      createdAt: l.createdAt,
    }))

  const attachments = db
    .prepare(
      `
      SELECT a.*, u.name AS uploaderName
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

  if (body.title != null) patch.title = String(body.title).trim()
  if (body.description != null) patch.description = String(body.description)
  if (body.why != null) patch.why = String(body.why)
  if (body.acceptanceCriteria != null) patch.acceptanceCriteria = String(body.acceptanceCriteria) || null
  if (body.category !== undefined) patch.category = body.category ? String(body.category) : null
  if (body.priority !== undefined) patch.priority = body.priority ? String(body.priority) : null
  if (body.tags !== undefined) patch.tagsJson = JSON.stringify(jsonArray(body.tags))
  if (body.links !== undefined) patch.linksJson = JSON.stringify(jsonArray(body.links))
  if (body.impactScope !== undefined) patch.impactScope = body.impactScope ? String(body.impactScope) : null
  if (body.createdAt != null) {
    if (user.role !== 'admin') return res.status(403).json({ message: 'forbidden' })
    const t = new Date(String(body.createdAt))
    if (Number.isNaN(t.getTime())) return res.status(400).json({ message: 'invalid createdAt' })
    patch.createdAt = t.toISOString()
  }

  if (patch.title === '') return res.status(400).json({ message: 'title required' })
  if (patch.description != null && !String(patch.description).trim()) return res.status(400).json({ message: 'description required' })
  if (patch.why != null && !String(patch.why).trim()) return res.status(400).json({ message: 'why required' })

  patch.updatedAt = nowIso()

  const fields = Object.keys(patch)
  if (!fields.length) return res.json({ ok: true })

  const setSql = fields.map((f) => `${f}=@${f}`).join(', ')
  db.prepare(`UPDATE requests SET ${setSql} WHERE id=@id`).run({ id, ...patch })
  const note = patch.createdAt ? '编辑需求字段（含提交时间）' : '编辑需求字段'
  addAudit({ requestId: id, actorId: user.id, actionType: 'edit', note, fromValue: { status: current.status }, toValue: { status: current.status } })
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

  if (!toStatus) return res.status(400).json({ message: 'toStatus required' })
  if (!isTransitionAllowed(current.status, toStatus)) return res.status(400).json({ message: 'transition not allowed' })
  if (!reason) return res.status(400).json({ message: 'reason required' })
  if (toStatus === 'Suspended' && !suspendUntil && !suspendCondition) {
    return res.status(400).json({ message: 'Suspended requires suspendUntil or suspendCondition' })
  }

  const t = nowIso()
  const patch = {
    status: toStatus,
    reviewerId: user.id,
    decisionReason: reason,
    suspendUntil: toStatus === 'Suspended' ? (suspendUntil || null) : null,
    suspendCondition: toStatus === 'Suspended' ? (suspendCondition || null) : null,
    updatedAt: t,
  }

  db.prepare(
    `
    UPDATE requests
    SET status=@status, reviewerId=@reviewerId, decisionReason=@decisionReason, suspendUntil=@suspendUntil, suspendCondition=@suspendCondition, updatedAt=@updatedAt
    WHERE id=@id
  `,
  ).run({ id, ...patch })

  addAudit({
    requestId: id,
    actorId: user.id,
    actionType: 'status_change',
    fromValue: { status: current.status },
    toValue: { status: toStatus, decisionReason: reason, suspendUntil: patch.suspendUntil, suspendCondition: patch.suspendCondition },
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

  const att = {
    id: nanoid(),
    requestId: id,
    uploaderId: user.id,
    filename: file.originalname || file.filename,
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
