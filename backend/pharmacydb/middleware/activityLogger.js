import ActivityLog from '../models/ActivityLog.js';

/**
 * logActivity — call this inside any route to record an action.
 *
 * Usage example inside a route:
 *   await logActivity(req, {
 *     action: 'ADD_MEDICINE',
 *     module: 'Inventory',
 *     description: `Added new medicine batch: ${medicine.name}`,
 *     targetId: medicine._id.toString(),
 *     status: 'success',
 *   });
 */
export const logActivity = async (req, { action, module, description, targetId = null, details = null, status = 'success' }) => {
  try {
    if (!req.user) return; // No user attached (unauthenticated), skip

    await ActivityLog.create({
      userId:      req.user._id,
      userName:    req.user.name,
      userRole:    req.user.role,
      action,
      module,
      description,
      targetId,
      details,
      status,
      ipAddress:   req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    });
  } catch (err) {
    // Never crash the main request if logging fails — just warn
    console.warn('[ActivityLogger] Failed to log activity:', err.message);
  }
};

/**
 * logLoginActivity — specialized helper for login/logout events
 * since those happen before req.user is set by protect middleware.
 *
 * Usage example in userRoutes login handler:
 *   await logLoginActivity({
 *     userId:   user._id,
 *     userName: user.name,
 *     userRole: user.role,
 *     action:   'LOGIN',
 *     description: `${user.name} logged in successfully`,
 *     status:   'success',
 *     ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
 *   });
 */
export const logLoginActivity = async ({ userId, userName, userRole, action, description, status = 'success', ipAddress = null }) => {
  try {
    await ActivityLog.create({
      userId,
      userName,
      userRole,
      action,
      module: 'Authentication',
      description,
      targetId:  null,
      details:   null,
      status,
      ipAddress,
    });
  } catch (err) {
    console.warn('[ActivityLogger] Failed to log login activity:', err.message);
  }
};