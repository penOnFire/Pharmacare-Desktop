import mongoose from 'mongoose';
import { emrConnection } from '../config/db.js'; // Import the secondary connection

const patientSchema = new mongoose.Schema({
  patientId: { type: String, required: true, unique: true }, // EMR uses this String ID
  firstname: { type: String, required: true },
  lastname: { type: String, required: true },
  dob: { type: Date },
  gender: { type: String },
  status: { type: String, default: "active" },
}, { timestamps: true });

// Use emrDB to read from the EMR database
// Note: 'PatientModel' matches the name they used in their export
const Patient = emrConnection.model('PatientModel', patientSchema, 'patients');

export default Patient;