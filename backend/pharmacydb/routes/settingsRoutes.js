import express from 'express';
import { logActivity } from '../utils/logActivity.js';
import { protect } from '../middleware/authMiddleware.js';
import SystemSettings from '../models/SystemSettings.js';

const router = express.Router();

// @route   GET /api/settings
// @desc    Get current settings (Auto-create if missing)
router.get('/', protect, async (req, res) => {
  try {
    let settings = await SystemSettings.findOne();
    if (!settings) {
      settings = await SystemSettings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   PUT /api/settings
// @desc    Toggle Integrations ON/OFF
router.put('/', protect, async (req, res) => {
  try {
    const { emr, billing } = req.body;
    
    let settings = await SystemSettings.findOne();
    if (!settings) settings = new SystemSettings();

    // Check if 'emr' was sent in the request body
    if (emr && typeof emr.enabled !== 'undefined') {
        settings.emr.enabled = emr.enabled;
    }

    // Check if 'billing' was sent in the request body
    if (billing && typeof billing.enabled !== 'undefined') {
        settings.billing.enabled = billing.enabled;
    }

    const updated = await settings.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;