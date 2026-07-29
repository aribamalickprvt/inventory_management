const db = require('../config/db');

/**
 * Refresh tokens are never stored in plaintext — only a SHA-256 hash of the
 * token is persisted (see TokenService.hashToken). Even if the database
 * leaks, raw refresh tokens can't be reconstructed from it.
 */
class RefreshTokenRepository {
  async create({ id, userId, tokenHash, expiresAt }) {
    await db.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked)
       VALUES (?, ?, ?, ?, FALSE)`,
      [id, userId, tokenHash, expiresAt]
    );
  }

  async findByHash(tokenHash) {
    const [rows] = await db.query(
      'SELECT * FROM refresh_tokens WHERE token_hash = ?',
      [tokenHash]
    );
    return rows[0] || null;
  }

  async revoke(id) {
    await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE id = ?', [id]);
  }

  async revokeAllForUser(userId) {
    await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = ?', [userId]);
  }
}

module.exports = new RefreshTokenRepository();
