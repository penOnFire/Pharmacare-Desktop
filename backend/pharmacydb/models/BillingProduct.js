import mongoose from 'mongoose';

const billingProductSchema = new mongoose.Schema(
  {
    name: { type: String, required: true }, // From Medicine Name
    sellingPrice: { type: Number, required: true }, // From Inventory Selling Price
    
    // We MUST keep this hidden ID so we know which item to update if price changes
    inventoryRefId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true }
  },
  { timestamps: true }
);

const BillingProduct = mongoose.model('BillingProduct', billingProductSchema);
export default BillingProduct;