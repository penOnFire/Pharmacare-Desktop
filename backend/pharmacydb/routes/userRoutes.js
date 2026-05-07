import express from 'express';
import { logActivity, logLoginActivity } from '../utils/logActivity.js';
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
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;

    if (!user) return res.status(401).json({ message: 'Invalid email or password' });

    // 1. Lock Check
    if (user.isLocked) {
        if (await user.matchTempPassword(password)) {
            user.isLocked = false;
            user.failedLoginAttempts = 0;
            user.tempPassword = null;
            user.lastLogin = Date.now();
            await user.save();

            // 🔥 DETAILED LOG
            await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'LOGIN', description: 'Logged in and successfully unlocked account via temporary password.', ipAddress });

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
        
        // 🔥 DETAILED LOG
        await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'FAILED_LOGIN', description: 'Failed login attempt on a locked account.', status: 'failed', ipAddress });
        
        // 🔥 SMART ERROR MESSAGE: Check if the Admin has already issued a temporary password
        const isTempPassIssued = user.tempPassword && user.tempPassword.trim() !== '';
        const errorMessage = isTempPassIssued 
            ? 'Incorrect temporary password. Please try again.' 
            : 'Account is locked. Please contact an Admin to unlock your account.';

        return res.status(403).json({ message: errorMessage });
    }

    // 2. Inactive Check
    if (user.status === 'inactive') {
        // 🔥 DETAILED LOG
        await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'FAILED_LOGIN', description: 'Failed login attempt on a deactivated account.', status: 'failed', ipAddress });
        return res.status(403).json({ message: 'Account deactivated.' });
    }

    // 3. Password Check
    if (await user.matchPassword(password)) {
        user.failedLoginAttempts = 0;
        user.lastLogin = Date.now();
        await user.save();

        // 🔥 DETAILED LOG
        await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'LOGIN', description: 'User logged in successfully.', ipAddress });

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
            
            // 🔥 DETAILED LOG
            await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'FAILED_LOGIN', description: 'Maximum login attempts exceeded (3/3). Account automatically locked.', status: 'failed', ipAddress });
            return res.status(403).json({ message: 'Maximum attempts exceeded. Account LOCKED.' });
        }
        await user.save();
        
        // 🔥 DETAILED LOG
        await logLoginActivity({ userId: user._id, userName: user.name, userRole: user.role, action: 'FAILED_LOGIN', description: `Invalid password entered. ${3 - user.failedLoginAttempts} attempts left before lockout.`, status: 'failed', ipAddress });
        res.status(401).json({ message: `Invalid password. ${3 - user.failedLoginAttempts} attempts left.` });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   POST /api/users/logout
// @desc    Log out user and record activity
router.post('/logout', protect, async (req, res) => {
  try {
    const ipAddress = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || null;
    
    // 🔥 DETAILED LOG FOR LOGOUT
    await logLoginActivity({ 
        userId: req.user._id, 
        userName: req.user.name, 
        userRole: req.user.role, 
        action: 'LOGOUT', 
        description: 'User logged out successfully.', 
        ipAddress 
    });

    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Server error during logout' });
  }
});

// @route   PUT /api/users/profile
// @desc    User updates their own profile (Change Password)
router.put('/profile', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const changes = [];

    if (req.body.password) {
        user.password = req.body.password;
        user.mustChangePassword = false; 
        changes.push('password');
    }
    if (req.body.name && user.name !== req.body.name) {
        changes.push('name');
        user.name = req.body.name;
    }
    if (req.body.email && user.email !== req.body.email) {
        changes.push('email');
        user.email = req.body.email;
    }

    const updatedUser = await user.save();

    let desc = `User updated their own profile.`;
    if (changes.length > 0) {
        desc = `User updated their own profile: Changed ${changes.join(', ')}.`;
    }

    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: 'EDIT_USER',
      module: 'User Management',
      description: desc,
      targetId: updatedUser._id.toString()
    });

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
    const data = req.body.newUserData || req.body; 
    const passwordToCheck = req.body.adminPassword || data.adminPassword;

    if (!passwordToCheck) {
        return res.status(401).json({ message: 'Admin password is required for confirmation' });
    }

    const adminUser = await User.findById(req.user._id);
    if (!adminUser) return res.status(404).json({ message: 'Admin user not found' });
    
    const isMatch = await adminUser.matchPassword(passwordToCheck);
    if (!isMatch) {
        return res.status(401).json({ message: 'Incorrect admin password' });
    }

    const { name, email, password, role, status } = data;
    
    const validRoles = ['admin', 'pharmacist', 'pharmacy assistant'];
    if (!validRoles.includes(role)) {
        return res.status(400).json({ message: `Invalid role selected: ${role}` });
    }

    const userExists = await User.findOne({ email });
    if (userExists) {
        return res.status(400).json({ message: 'User already exists with this email' });
    }

    const nextId = await getNextSequenceValue('userId');
    const user = await User.create({ 
      userId: formatUserId(nextId),
      name, 
      email, 
      password, 
      role, 
      status: status || 'active' 
    });
    
    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: 'CREATE_USER',
      module: 'User Management',
      description: `Created new user account for '${user.name}' with role: ${user.role}`,
      targetId: user._id.toString()
    });

    res.status(201).json(user);
  } catch (err) {
    console.error("User Creation Error:", err);
    res.status(500).json({ message: err.message || 'Server Error' });
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

    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: 'RESET_PASSWORD',
      module: 'User Management',
      description: `Unlocked account and generated a temporary password for user '${user.name}'.`,
      targetId: user._id.toString()
    });

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

    // 🔥 Track exact changes for the log
    const changes = [];

    if (updatedUserData.name && user.name !== updatedUserData.name) {
        changes.push(`name to '${updatedUserData.name}'`);
        user.name = updatedUserData.name;
    }
    if (updatedUserData.email && user.email !== updatedUserData.email) {
        changes.push(`email to '${updatedUserData.email}'`);
        user.email = updatedUserData.email;
    }
    if (updatedUserData.role && user.role !== updatedUserData.role) {
        changes.push(`role to '${updatedUserData.role}'`);
        user.role = updatedUserData.role;
    }
    if (updatedUserData.status && user.status !== updatedUserData.status) {
        changes.push(`status to '${updatedUserData.status}'`);
        user.status = updatedUserData.status;
    }
    if (updatedUserData.password && updatedUserData.password.trim() !== '') {
        changes.push(`password`);
        user.password = updatedUserData.password;
    }
    
    const updatedUser = await user.save();

    // Construct the detailed description
    let desc = `Updated details for user '${user.name}'`;
    if (changes.length > 0) {
        desc += `: Changed ${changes.join(', ')}.`;
    } else {
        desc += ` (No data was actually changed).`;
    }

    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: 'EDIT_USER',
      module: 'User Management',
      description: desc,
      targetId: updatedUser._id.toString()
    });

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

    const userName = user.name;
    const userRole = user.role;
    await user.deleteOne();

    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: 'OTHER',
      module: 'User Management',
      description: `Permanently deleted user account: '${userName}' (${userRole}).`,
      targetId: req.params.id
    });

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

    const oldStatus = user.status;
    user.status = user.status === 'active' ? 'inactive' : 'active';
    await user.save();

    // 🔥 DETAILED LOG
    await logActivity(req, {
      action: user.status === 'inactive' ? 'DEACTIVATE_USER' : 'EDIT_USER',
      module: 'User Management',
      description: `Changed user status for '${user.name}' from '${oldStatus}' to '${user.status}'.`,
      targetId: user._id.toString()
    });

    res.json(user);
  } catch (err) {
    res.status(err.message === 'Invalid admin password' ? 401 : 500).json({ message: err.message });
  }
});

export default router;