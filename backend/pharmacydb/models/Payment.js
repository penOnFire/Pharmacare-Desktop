import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
    transactionId: String,
    invoiceNumber: String,
    patientName: String,
    patientId: String,
    amount: Number,
    method: String,
    status: String
}, { 
    collection: 'payments', // 🔥 Forces Mongoose to look at their exact collection
    timestamps: true 
});

export default mongoose.model('Payment', paymentSchema);