import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    userId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true },
    role: { type: String, required: true, enum: ['admin', 'pharmacist', 'pharmacy assistant'], default: 'pharmacist' },
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
    lastLogin: { type: Date, default: null },
    
    // Security Fields
    failedLoginAttempts: { type: Number, required: true, default: 0 },
    isLocked: { type: Boolean, default: false },
    mustChangePassword: { type: Boolean, default: false },
    tempPassword: { type: String, default: null },
  },
  { timestamps: true }
);

// --- FIX IS HERE: Added 'return' ---
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next(); // <--- THIS 'return' IS CRITICAL
  }
  
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.matchTempPassword = async function (enteredTempPassword) {
  if (!this.tempPassword) return false; 
  return await bcrypt.compare(enteredTempPassword, this.tempPassword);
};

const User = mongoose.model('User', userSchema);
export default User;