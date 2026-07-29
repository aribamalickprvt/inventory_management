const db = require('../config/db');
const { User } = require('../domain/User');

class UserRepository {
  async findByEmail(email) {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return null;
    return this._toDomain(rows[0]);
  }

  async findById(id) {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    if (rows.length === 0) return null;
    return this._toDomain(rows[0]);
  }

  async create(user) {
    await db.query(
      `INSERT INTO users (id, email, password_hash, role) VALUES (?, ?, ?, ?)`,
      [user.id, user.email, user.passwordHash, user.role]
    );
    return user;
  }

  _toDomain(row) {
    return new User({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      role: row.role,
    });
  }
}

module.exports = new UserRepository();
