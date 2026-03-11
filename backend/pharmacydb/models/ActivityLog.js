import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    // Who performed the action
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: { type: String, required: true },
    userRole: {
      type: String,
      enum: ['admin', 'pharmacist', 'pharmacy_assistant'],
      required: true,
    },

    // What they did
    action: {
      type: String,
      required: true,
      enum: [
        // Auth
        'LOGIN',
        'LOGOUT',
        'FAILED_LOGIN',
        // Inventory
        'ADD_MEDICINE',
        'EDIT_MEDICINE',
        'ARCHIVE_MEDICINE',
        'RESTORE_MEDICINE',
        'DELETE_MEDICINE',
        // Sales & Billing
        'CREATE_SALE',
        'VOID_SALE',
        // Prescriptions
        'ADD_PRESCRIPTION',
        'UPDATE_PRESCRIPTION',
        'DISPENSE_PRESCRIPTION',
        // Patients
        'ADD_PATIENT',
        'EDIT_PATIENT',
        'DELETE_PATIENT',
        // User Management (admin only)
        'CREATE_USER',
        'EDIT_USER',
        'DEACTIVATE_USER',
        'RESET_PASSWORD',
        // Other
        'OTHER',
      ],
    },

    // Which module/section it happened in
    module: {
      type: String,
      enum: [
        'Authentication',
        'Inventory',
        'Sales & Billing',
        'Prescriptions',
        'Patient Records',
        'User Management',
        'Counter Dispensing',
        'Other',
      ],
      required: true,
    },

    // Human-readable description of the action
    description: { type: String, required: true },

    // Optional: the ID of the affected record (e.g. medicine ID, sale ID)
    targetId: { type: String, default: null },

    // Optional: additional details (e.g. changed fields)
    details: { type: mongoose.Schema.Types.Mixed, default: null },

    // Status of the action
    status: {
      type: String,
      enum: ['success', 'failed'],
      default: 'success',
    },

    // IP address of the request
    ipAddress: { type: String, default: null },
  },
  { timestamps: true } // createdAt = when the action happened
);

// Index for fast queries — most common filters
activityLogSchema.index({ userId: 1 });
activityLogSchema.index({ userRole: 1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ module: 1 });
activityLogSchema.index({ createdAt: -1 }); // newest first

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
export default ActivityLog;