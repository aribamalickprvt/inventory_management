const bcrypt = require('bcrypt');
const { randomUUID } = require('crypto');
const { User } = require('../domain/User');
const userRepository = require('../repositories/UserRepository');
const refreshTokenRepository = require('../repositories/RefreshTokenRepository');
const tokenService = require('./TokenService');
const env = require('../config/env');

const SALT_ROUNDS = 12;

class AuthService {
  async register({ email, password, role }) {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    const existing = await userRepository.findByEmail(email);
    if (existing) throw new Error('Email is already registered');

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = new User({ id: randomUUID(), email, passwordHash, role });
    await userRepository.create(user);

    return { id: user.id, email: user.email, role: user.role };
  }

  async login({ email, password }) {
    const user = await userRepository.findByEmail(email);
    // Same error for "no such user" and "wrong password" — never reveal which one it was.
    if (!user) throw new Error('Invalid email or password');

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) throw new Error('Invalid email or password');

    return this._issueTokenPair(user);
  }

  /**
   * Sliding-window refresh: every time a refresh token is used, it is
   * immediately revoked ("rotated") and replaced by a brand-new refresh
   * token with a fresh expiry window. This means a user who stays active
   * never gets logged out, but a leaked, unused refresh token has a hard
   * expiry ceiling — and reusing an already-rotated token is a strong signal
   * of theft, so it revokes the entire token immediately.
   */
  async refresh(refreshToken) {
    if (!refreshToken) throw new Error('Refresh token is required');

    const tokenHash = tokenService.hashToken(refreshToken);
    const stored = await refreshTokenRepository.findByHash(tokenHash);

    if (!stored) throw new Error('Refresh token is invalid');
    if (stored.revoked) throw new Error('Refresh token has been revoked');
    if (new Date(stored.expires_at) < new Date()) throw new Error('Refresh token has expired');

    await refreshTokenRepository.revoke(stored.id); // rotate: old token is now dead

    const user = await userRepository.findById(stored.user_id);
    if (!user) throw new Error('User no longer exists');

    return this._issueTokenPair(user);
  }

  async logout(refreshToken) {
    if (!refreshToken) return;
    const tokenHash = tokenService.hashToken(refreshToken);
    const stored = await refreshTokenRepository.findByHash(tokenHash);
    if (stored && !stored.revoked) {
      await refreshTokenRepository.revoke(stored.id);
    }
  }

  async _issueTokenPair(user) {
    const accessToken = tokenService.generateAccessToken(user);
    const refreshToken = tokenService.generateRefreshToken();
    const tokenHash = tokenService.hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await refreshTokenRepository.create({
      id: randomUUID(),
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: env.ACCESS_TOKEN_TTL,
      role: user.role,
    };
  }
}

module.exports = new AuthService();
