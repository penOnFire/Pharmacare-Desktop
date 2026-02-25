import mongoose from 'mongoose';

const saleSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Patient',
      required: true,
    },
    patientName: { 
    type: String, 
    required: true 
  },
    pharmacist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    prescription: { // Optional, for sales linked to a prescription
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Prescription',
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    items: [ // The embedded array of items sold
      {
        medicine: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Medicine',
          required: true,
        },
        name: { type: String, required: true },
        inventory: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Inventory',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        priceAtSale: { // Captures the price at the moment of the transaction
          type: Number,
          required: true,
        },
      },
    ],
  },
  { timestamps: true }
);

const Sale = mongoose.model('Sale', saleSchema);

export default Sale;