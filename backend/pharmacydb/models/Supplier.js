import mongoose from 'mongoose';

const supplierSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    contactPerson: { type: String, required: true },
    email: { type: String, required: true },
    phone: { type: String, required: true },
    address: { type: String },
    reliabilityRating: { type: Number, default: 5, min: 1, max: 5 },
    
    // ADD THIS NEW FIELD (Required for the frontend logic)
    failedDeliveries: { type: Number, default: 0 },
    
    isBlocked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const Supplier = mongoose.model('Supplier', supplierSchema);
export default Supplier;