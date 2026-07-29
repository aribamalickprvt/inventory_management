const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

/**
 * Access tokens: short-lived JWTs, self-contained (no DB lookup needed to verify).
 * Refresh tokens: opaque random strings, NOT JWTs — they're meaningless on their
 * own and only useful when looked up (hashed) against the database, which is
 * what makes revocation possible. A JWT refresh token can't be revoked before
 * its natural expiry without an extra denylist; an opaque + DB-backed token can.
 */
class TokenService {
  generateAccessToken(user) {
    return jwt.sign(
      { sub: user.id, role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.ACCESS_TOKEN_TTL }
    );
  }

  verifyAccessToken(token) {
    return jwt.verify(token, env.JWT_ACCESS_SECRET); // throws TokenExpiredError / JsonWebTokenError
  }

  generateRefreshToken() {
    return crypto.randomBytes(40).toString('hex');
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}

module.exports = new TokenService();
