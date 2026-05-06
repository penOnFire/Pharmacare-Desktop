import mongoose, { version } from 'mongoose';

const medicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    genericName: {
      type: String,
    },
    category: {
      type: String,
      required: true,
      enum: ['Pain Relief', 'Antihistamine', 'Gastrointestinal', 'Diabetes', 'Cardiovascular','Antibiotics']
    },
    type: {
      type: String, // e.g., 'Tablet', 'Syrup', 'Ointment'
      required: true,
    },
    strength: {
      type: String, 
      required: true, // Assuming you always want a dosage
      enum: ['100mg', '250mg', '500mg', '1000mg','10mg', '10mg/5ml', '20mg'], // The allowed list
      default: '500mg' // Optional default
    },
    supplier: { 
      type: String, default: 'N/A' 
    },
    requiresPrescription: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
  {versionKey: false}
);

const Medicine = mongoose.model('Medicine', medicineSchema);

export default Medicine;