import mongoose from 'mongoose';
import { emrConnection } from '../config/db.js';

// "strict: false" lets us read ALL fields (medicname, dosage, etc.) without defining them perfectly
const prescriptionSchema = new mongoose.Schema({}, { 
    strict: false, 
    timestamps: true 
});

// The 3rd argument MUST be 'medications' if that is what the EMR developer named it.
// If this is wrong, you will get an empty array [].
const Prescription = emrConnection.model('Prescribe', prescriptionSchema, 'medications');

export default Prescription;