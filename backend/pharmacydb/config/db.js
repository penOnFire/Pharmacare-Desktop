import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// 1. Primary Connection (Pharmacy DB)
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI);
    console.log(`✅ Pharmacy DB Connected (Atlas): ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Pharmacy DB Error: ${error.message}`);
    process.exit(1);
  }
};

// 2. Secondary Connection (EMR DB)
// --- DEFINITION ---
const emrConnection = mongoose.createConnection(process.env.EMR_URI); 

emrConnection.on('connected', () => {
  console.log('✅ EMR Database Connected (Atlas)');
});

emrConnection.on('error', (err) => {
  console.error('❌ EMR Connection Error:', err);
});

// Billings Connection
const billingConnection = mongoose.createConnection(process.env.BILLING_MONGO_URI);

billingConnection.on('connected', () => {
  console.log('✅ Billing Database Connected (Atlas)');
});

billingConnection.on('error', (err) => {
  console.error('❌ Billing Connection Error:', err);
});   

// --- EXPORT (Must match the name above!) ---
export { connectDB, emrConnection, billingConnection };