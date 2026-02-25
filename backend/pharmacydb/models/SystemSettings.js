import mongoose from 'mongoose';

const systemSettingsSchema = new mongoose.Schema({
  emr: {
    enabled: { type: Boolean, default: false },
    // Store connection details internally if needed, or use .env
    lastSync: { type: Date }
  },
  billing: {
    enabled: { type: Boolean, default: false },
    lastSync: { type: Date }
  }
}, { timestamps: true });

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);
export default SystemSettings;