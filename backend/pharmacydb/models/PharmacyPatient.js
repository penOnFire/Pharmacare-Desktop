import mongoose from 'mongoose';

const pharmacyPatientSchema = new mongoose.Schema({
    patientId: { type: String, required: true, unique: true }, // Links to EMR string ID "P006"
    status: { 
        type: String, 
        default: 'No Prescription',
        enum: ['Pending', 'No Prescription', 'Completed']
    },
    lastDispensedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const PharmacyPatient = mongoose.model('PharmacyPatient', pharmacyPatientSchema);
export default PharmacyPatient;