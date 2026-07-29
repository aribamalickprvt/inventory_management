const authService = require('../services/AuthService');

class AuthController {
  async register(req, res) {
    try {
      const { email, password, role } = req.body;
      const user = await authService.register({ email, password, role });
      res.status(201).json(user);
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;
      const tokens = await authService.login({ email, password });
      res.status(200).json(tokens);
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  }

  async refresh(req, res) {
    try {
      const { refreshToken } = req.body;
      const tokens = await authService.refresh(refreshToken);
      res.status(200).json(tokens);
    } catch (err) {
      res.status(401).json({ error: err.message });
    }
  }

  async logout(req, res) {
    try {
      const { refreshToken } = req.body;
      await authService.logout(refreshToken);
      res.status(204).send();
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new AuthController();
