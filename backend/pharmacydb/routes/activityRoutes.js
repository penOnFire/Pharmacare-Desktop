import { logActivity } from '../utils/logActivity.js';
import express from 'express';
import ActivityLog from '../models/ActivityLog.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// ══════════════════════════════════════════════════════════
// GET /api/activity
// Admin only — fetch all activity logs with filters & pagination
// ══════════════════════════════════════════════════════════
router.get('/', protect, admin, async (req, res) => {
  try {
    const {
      page      = 1,
      limit     = 20,
      role,         // filter by userRole
      action,       // filter by action type
      module,       // filter by module
      status,       // filter by success/failed
      userId,       // filter by specific user
      startDate,    // filter from date
      endDate,      // filter to date
      search,       // search by userName or description
    } = req.query;

    // Build filter object dynamically
    const filter = {};

    if (role)    filter.userRole = role;
    if (action)  filter.action   = action;
    if (module)  filter.module   = module;
    if (status)  filter.status   = status;
    if (userId)  filter.userId   = userId;

    // Date range filter
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // include full end day
        filter.createdAt.$lte = end;
      }
    }

    // Search by userName or description (case-insensitive)
    if (search) {
      filter.$or = [
        { userName:    { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const total = await ActivityLog.countDocuments(filter);
    const logs  = await ActivityLog.find(filter)
      .sort({ createdAt: -1 }) // newest first
      .skip(skip)
      .limit(parseInt(limit));

    res.json({
      logs,
      pagination: {
        total,
        page:       parseInt(page),
        limit:      parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('Activity log fetch error:', err);
    res.status(500).json({ message: 'Server error fetching activity logs' });
  }
});

// ══════════════════════════════════════════════════════════
// GET /api/activity/stats
// Admin only — summary counts for the dashboard overview
// ══════════════════════════════════════════════════════════
router.get('/stats', protect, admin, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get the exact timestamp for 24 hours ago
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const total = await ActivityLog.countDocuments();
    const todayCount = await ActivityLog.countDocuments({ createdAt: { $gte: today } });
    
    const byRole = await ActivityLog.aggregate([
      { $group: { _id: '$userRole', count: { $sum: 1 } } }
    ]);
    
    const byModule = await ActivityLog.aggregate([
      { $group: { _id: '$module', count: { $sum: 1 } } }
    ]);

    // 🔥 FIX 1: Use case-insensitive regex so "Failed" and "failed" both match!
    const recentFailed = await ActivityLog.countDocuments({
      status: { $regex: /^failed$/i },
      createdAt: { $gte: twentyFourHoursAgo }
    });

    // 🔥 FIX 2: Get unique active users who logged in today
    // distinct('userId') ensures that if a user logs in 5 times, they only count as 1 active user!
    const activeUsersToday = await ActivityLog.distinct('userId', {
      action: 'LOGIN',
      createdAt: { $gte: today }
    });
    const activeUsersCount = activeUsersToday.length;

    // Send the new activeUsersCount to the frontend
    res.json({ total, todayCount, byRole, byModule, recentFailed, activeUsersCount });
  } catch (err) {
    console.error('Activity stats error:', err);
    res.status(500).json({ message: 'Server error fetching activity stats' });
  }
});

// ══════════════════════════════════════════════════════════
// DELETE /api/activity/clear
// Admin only — clear logs older than 90 days
// ══════════════════════════════════════════════════════════
router.delete('/clear', protect, admin, async (req, res) => {
  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await ActivityLog.deleteMany({
      createdAt: { $lt: ninetyDaysAgo }
    });

    res.json({
      message: `Cleared ${result.deletedCount} log entries older than 90 days.`,
      deletedCount: result.deletedCount,
    });
  } catch (err) {
    console.error('Activity clear error:', err);
    res.status(500).json({ message: 'Server error clearing logs' });
  }
});

export default router;