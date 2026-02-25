import mongoose from 'mongoose';
import Medicine from './Medicine.js';
import BillingProduct from './BillingProduct.js';

const inventorySchema = new mongoose.Schema(
  {
    medicine: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Medicine',
      required: true,
    },
    batchNumber: {
      type: String,
      required: true,
    },
    expiryDate: {
      type: Date,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
    },
    costPrice: {
      type: Number,
      required: true,
    },
    sellingPrice: {
      type: Number,
      required: true,
    },
    minStockLevel: {
      type: Number,
      default: 10,
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

inventorySchema.post('save', async function (doc) {
  try {
    const med = await Medicine.findById(doc.medicine);
    if (!med) return;

    // Update the simplified collection automatically
    await BillingProduct.findOneAndUpdate(
        { inventoryRefId: doc._id },
        { 
            name: `${med.name} ${med.strength}`,
            sellingPrice: doc.sellingPrice,
            inventoryRefId: doc._id
        },
        { upsert: true } // Create if it doesn't exist
    );
  } catch (err) {
    console.error("Billing Sync Error:", err);
  }
});

const Inventory = mongoose.model('Inventory', inventorySchema);
export default Inventory;