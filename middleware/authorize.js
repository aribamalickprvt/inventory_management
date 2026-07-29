/**
 * Role-Based Access Control middleware. Must run AFTER authenticate() —
 * it relies on req.user being already set.
 *
 * Usage: router.get('/admin-only', authenticate, authorize('ADMIN'), handler)
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'Must be authenticated before authorization can be checked.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: `Role '${req.user.role}' is not permitted to access this resource.`,
      });
    }
    next();
  };
}

module.exports = authorize;
