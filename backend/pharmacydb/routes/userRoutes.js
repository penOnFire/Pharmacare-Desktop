import ActivityLog from '../models/ActivityLog.js';
import express from 'express';
import { logActivity } from '../utils/logActivity.js';
import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { protect, admin } from '../middleware/authMiddleware.js';
import { getNextSequenceValue, formatUserId } from '../utils/counters.js';

const router = express.Router();

// --- HELPER: Verify Admin Password ---
const verifyAdminPassword = async (adminId, passwordAttempt) => {
    const adminUser = await User.findById(adminId).select('+password');
    if (!adminUser || !(await adminUser.matchPassword(passwordAttempt))) {
        throw new Error('Invalid admin password');
    }
    return true;
};

// =========================================================================
//  SPECIFIC ROUTES (MUST BE BEFORE /:id ROUTES)
// =========================================================================

// @route   POST /api/users/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');

    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    // 1. Lock Check
    if (user.isLocked) {
        if (await user.matchTempPassword(password)) {
            user.isLocked = false;
            user.failedLoginAttempts = 0;
            user.tempPassword = null;
            user.lastLogin = Date.now();
            await user.save();

            return res.json({
                _id: user._id,
                userId: user.userId,
                name: user.name,
                email: user.email,
                role: user.role,
                status: user.status,
                mustChangePassword: user.mustChangePassword,
                token: jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' }),
                message: 'Account unlocked via temporary password.'
            });
        }
        return res.status(403).json({ message: 'Account is locked. Use temporary password.' });
    }

    // 2. Inactive Check
    if (user.status === 'inactive') return res.status(403).json({ message: 'Account deactivated.' });

    // 3. Password Check
    if (await user.matchPassword(password)) {
        user.failedLoginAttempts = 0;
        user.lastLogin = Date.now();
        await user.save();

        res.json({
            _id: user._id,
            userId: user.userId,
            name: user.name,
            email: user.email,
            role: user.role,
            status: user.status,
            lastLogin: user.lastLogin,
            token: jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' }),
        });
    } else {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= 3) {
            user.isLocked = true;
            await user.save();
            return res.status(403).json({ message: 'Maximum attempts exceeded. Account LOCKED.' });
        }
        await user.save();
        res.status(401).json({ message: `Invalid password. ${3 - user.failedLoginAttempts} attempts left.` });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   PUT /api/users/profile  <-- MOVED UP HERE
// @desc    User updates their own profile (Change Password)
router.put('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (req.body.password) {
        user.password = req.body.password;
        user.mustChangePassword = false; 
    }
    // Update name/email if needed
    if (req.body.name) user.name = req.body.name;
    if (req.body.email) user.email = req.body.email;

    const updatedUser = await user.save();

    res.json({
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        token: jwt.sign({ id: updatedUser._id, role: updatedUser.role }, process.env.JWT_SECRET, { expiresIn: '1d' }),
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// =========================================================================
//  ADMIN MANAGEMENT ROUTES
// =========================================================================

// @route   POST /api/users
router.post('/', protect, admin, async (req, res) => {
  try {
    const { adminPassword, newUserData } = req.body; 
    const data = newUserData || req.body; 
    const passwordToCheck = adminPassword || req.body.adminPassword;

    await verifyAdminPassword(req.user._id, passwordToCheck).catch(() => {
        throw new Error('Invalid admin password');
    });

    const { name, email, password, role, status } = data;
    if (await User.findOne({ email })) return res.status(400).json({ message: 'User exists' });

    const nextId = await getNextSequenceValue('userId');
    const user = await User.create({ 
      userId: formatUserId(nextId),
      name, email, password, role, 
      status: status || 'active' 
    });
    
    res.status(201).json(user);
  } catch (err) {
    res.status(err.message === 'Invalid admin password' ? 401 : 500).json({ message: err.message });
  }
});

// @route   GET /api/users
router.get('/', protect, admin, async (req, res) => {
  const users = await User.find({}).select('-password').sort({ createdAt: -1 });
  res.json(users);
});

// @route   POST /api/users/:id/unlock
router.post('/:id/unlock', protect, admin, async (req, res) => {
  try {
    const { tempPassword } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const salt = await bcrypt.genSalt(10);
    user.tempPassword = await bcrypt.hash(tempPassword, salt);
    user.isLocked = true; 
    user.mustChangePassword = true;
    
    await user.save();
    res.json({ message: `Temporary password set.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// =========================================================================
//  DYNAMIC ID ROUTES (MUST BE LAST)
// =========================================================================

// @route   PUT /api/users/:id
router.put('/:id', protect, admin, async (req, res) => {
  try {
    const { adminPassword, ...restOfData } = req.body;
    const updatedUserData = restOfData.updatedUserData || restOfData;

    await verifyAdminPassword(req.user._id, adminPassword).catch(() => {
        throw new Error('Invalid admin password');
    });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (updatedUserData.name) user.name = updatedUserData.name;
    if (updatedUserData.email) user.email = updatedUserData.email;
    if (updatedUserData.role) user.role = updatedUserData.role;
    if (updatedUserData.status) user.status = updatedUserData.status;
    
    if (updatedUserData.password && updatedUserData.password.trim() !== '') {
      user.password = updatedUserData.password;
    }
    
    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (err) {
    res.status(err.message === 'Invalid admin password' ? 401 : 500).json({ message: err.message });
  }
});

// @route   DELETE /api/users/:id
router.delete('/:id', protect, admin, async (req, res) => {
  try {
    const { adminPassword } = req.body;
    await verifyAdminPassword(req.user._id, adminPassword).catch(() => {
        throw new Error('Invalid admin password');
    });
    
    const user = await User.findById(req.params.id);
    if (user._id.equals(req.user._id)) return res.status(400).json({ message: "Cannot delete yourself" });

    await user.deleteOne();
    res.json({ message: 'User removed' });
  } catch (err) {
    res.status(err.message === 'Invalid admin password' ? 401 : 500).json({ message: err.message });
  }
});

// @route   PATCH /api/users/:id/status
router.patch('/:id/status', protect, admin, async (req, res) => {
  try {
    const { adminPassword } = req.body;
    await verifyAdminPassword(req.user._id, adminPassword).catch(() => {
        throw new Error('Invalid admin password');
    });

    const user = await User.findById(req.params.id);
    if (user._id.equals(req.user._id)) return res.status(400).json({ message: "Cannot deactivate yourself" });

    user.status = user.status === 'active' ? 'inactive' : 'active';
    await user.save();
    res.json(user);
  } catch (err) {
    res.status(err.message === 'Invalid admin password' ? 401 : 500).json({ message: err.message });
  }
});

export default router;