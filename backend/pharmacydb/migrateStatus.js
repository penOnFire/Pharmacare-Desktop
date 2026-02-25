import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Prescription from './models/Prescription.js'; // Make sure this path points to your Model

dotenv.config();

const migrateData = async () => {
  try {
    // 1. Connect to Database
    if (!process.env.MONGO_URI) {
      throw new Error("MONGO_URI is missing in .env file");
    }
    
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB...');

    // 2. Update "Filled" Prescriptions
    // Finds docs where isFilled is true, sets status to 'Filled'
    const filledUpdate = await Prescription.updateMany(
      { isFilled: true },
      { $set: { status: 'Filled' } }
    );
    console.log(`- Updated ${filledUpdate.modifiedCount} prescriptions to 'Filled'.`);

    // 3. Update "Pending" Prescriptions
    // Finds docs where isFilled is false OR status is missing, sets status to 'Pending'
    // We explicitly check where status does not exist to cover old data
    const pendingUpdate = await Prescription.updateMany(
      { 
        $or: [
          { isFilled: false },
          { status: { $exists: false } } 
        ]
      },
      { $set: { status: 'Pending' } }
    );
    console.log(`- Updated ${pendingUpdate.modifiedCount} prescriptions to 'Pending'.`);

    // 4. Cleanup (Optional)
    // Removes the old 'isFilled' field entirely so you don't have messy data
    const cleanup = await Prescription.updateMany(
      {},
      { $unset: { isFilled: 1 } }
    );
    console.log(`- Cleaned up 'isFilled' field from ${cleanup.modifiedCount} documents.`);

    console.log('🎉 Migration Complete! Database is now using the Status field.');
    process.exit();

  } catch (error) {
    console.error('❌ Migration Failed:', error);
    process.exit(1);
  }
};

migrateData();