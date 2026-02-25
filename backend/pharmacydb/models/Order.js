import mongoose from 'mongoose';

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    required: true,
    unique: true
  },
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Supplier',
    required: true
  },
  supplierName: { // Redundant but useful for quick UI display
    type: String,
    required: true
  },
  medicineName: { // Using name string since Inventory ID might change/delete
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  unitPrice: {
    type: Number,
    required: true
  },
  totalPrice: {
    type: Number,
    required: true
  },
  expectedDelivery: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Delivered', 'Cancelled', 'Failed'],
    default: 'Pending'
  },
  autoOrdered: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

const Order = mongoose.model('Order', orderSchema);

export default Order;