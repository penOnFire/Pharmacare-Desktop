import ActivityLog from '../models/ActivityLog.js';

export const logActivity = async (req, { action, module, description, targetId = null, details = null, status = 'success' }) => {
  try {
    if (!req.user) return;

    await ActivityLog.create({
      userId: req.user._id,
      userName: req.user.name,
      userRole: req.user.role,
      action,
      module,
      description,
      targetId,
      details,
      status,
      ipAddress: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null,
    });
  } catch (err) {
    console.warn('[ActivityLogger] Failed to log activity:', err.message);
  }
};

export const logLoginActivity = async ({ userId, userName, userRole, action, description, status = 'success', ipAddress = null }) => {
  try {
    await ActivityLog.create({
      userId,
      userName,
      userRole,
      action,
      module: 'Authentication',
      description,
      targetId: null,
      details: null,
      status,
      ipAddress,
    });
  } catch (err) {
    console.warn('[ActivityLogger] Failed to log login activity:', err.message);
  }
};