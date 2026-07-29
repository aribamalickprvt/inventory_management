/**
 * User - Entity
 * Not a full aggregate root with child entities (yet) — but still owns its own
 * invariants: valid email shape, valid role. Password hashing itself is a
 * service-layer concern (bcrypt is infrastructure, not a domain rule).
 */
class User {
  static ROLES = {
    ADMIN: 'ADMIN',
    CUSTOMER: 'CUSTOMER',
  };

  constructor({ id, email, passwordHash, role = User.ROLES.CUSTOMER }) {
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('A valid email is required');
    }
    if (!Object.values(User.ROLES).includes(role)) {
      throw new Error(`Invalid role: ${role}`);
    }
    this.id = id;
    this.email = email;
    this.passwordHash = passwordHash;
    this.role = role;
  }

  hasRole(...roles) {
    return roles.includes(this.role);
  }
}

module.exports = { User };
