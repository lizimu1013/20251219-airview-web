import jwt from 'jsonwebtoken'

export function getJwtSecret() {
  return process.env.JWT_SECRET || 'dev-secret-change-me'
}

export function signToken(payload) {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
}

export function authMiddleware(req, res, next) {
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null
  if (!token) return res.status(401).json({ message: 'Unauthorized' })

  try {
    const decoded = jwt.verify(token, getJwtSecret())
    req.user = decoded
    next()
  } catch {
    return res.status(401).json({ message: 'Unauthorized' })
  }
}

export function requireRole(roles) {
  return (req, res, next) => {
    const role = req.user?.role
    if (!role) return res.status(401).json({ message: 'Unauthorized' })
    if (!roles.includes(role)) return res.status(403).json({ message: 'Forbidden' })
    next()
  }
}

