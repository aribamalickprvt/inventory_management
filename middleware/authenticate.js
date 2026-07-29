const tokenService = require('../services/TokenService');

/**
 * Protects a route by requiring a valid Bearer access token.
 * Distinguishes "expired" from "invalid" so the client knows whether to call
 * /auth/refresh (expired — recoverable) or force a full re-login (invalid/tampered).
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'MISSING_TOKEN', message: 'Authorization header with Bearer token is required' });
  }

  const token = header.slice('Bearer '.length);

  try {
    const payload = tokenService.verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'TOKEN_EXPIRED', message: 'Access token has expired. Use /api/auth/refresh to get a new one.' });
    }
    return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Access token is malformed or invalid.' });
  }
}

module.exports = authenticate;
