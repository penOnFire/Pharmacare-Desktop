import mongoose from 'mongoose';

// Define the schema for the counters collection (already exists)
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence_value: { type: Number, default: 0 }
});

// Avoid re-registering the model if it already exists
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

// This function safely finds and increments the counter
export async function getNextSequenceValue(sequenceName) {
  const sequenceDocument = await Counter.findByIdAndUpdate(
    sequenceName,
    { $inc: { sequence_value: 1 } },
    { new: true, upsert: true }
  );
  return sequenceDocument.sequence_value;
}

// Function to format Patient ID (e.g., P001)
export function formatPatientId(sequenceNumber) {
    return `P${String(sequenceNumber).padStart(3, '0')}`;
}

// --- NEW FUNCTION ---
// Function to format User ID (e.g., U001)
export function formatUserId(sequenceNumber) {
    return `U${String(sequenceNumber).padStart(3, '0')}`;
}