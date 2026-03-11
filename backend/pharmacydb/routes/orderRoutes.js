import express from 'express';
import Order from '../models/Order.js';
import { protect } from '../middleware/authMiddleware.js';
import Supplier from '../models/Supplier.js';
import Medicine from '../models/Medicine.js';
import Inventory from '../models/Inventory.js';
const router = express.Router();

// @route   GET /api/orders
// @desc    Get all orders
router.get('/', protect, async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// @route   POST /api/orders
// @desc    Create a new order
router.post('/', protect, async (req, res) => {
  try {
    // Generate a simple ID if not provided (e.g. ORD-17156...)
    if (!req.body.orderId) {
        req.body.orderId = `ORD-${Date.now().toString().slice(-6)}`;
    }
    
    const order = new Order(req.body);
    const createdOrder = await order.save();
    res.status(201).json(createdOrder);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// @route   PUT /api/orders/:id
// @desc    Update order status
router.put('/:id', protect, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    // Check if we are marking it as Delivered for the first time
    if (req.body.status === 'Delivered' && order.status !== 'Delivered') {
        
        // 1. Find the Medicine ID based on the name in the order
        // (Since Order schema uses strings, we must find the linking ID)
        const medicine = await Medicine.findOne({ 
            name: { $regex: new RegExp(`^${order.medicineName}$`, 'i') } 
        });

        if (medicine) {
            // 2. Create a NEW Inventory Batch
            const newBatch = new Inventory({
                medicine: medicine._id,
                // Generate a batch number (e.g., "AUTO-20251025")
                batchNumber: `AUTO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}`,
                quantity: order.quantity,
                costPrice: order.unitPrice,
                sellingPrice: order.unitPrice, // Example markup (you can adjust)
                expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // Default 1 year expiry
                minStockLevel: 20,
                isArchived: false
            });
            
            await newBatch.save();
            console.log(`[RESTOCK] Added ${order.quantity} of ${order.medicineName} to inventory.`);
        } else {
            console.error(`[RESTOCK FAILED] Could not find medicine: ${order.medicineName}`);
        }
    }

    // Update the order status
    order.status = req.body.status || order.status;
    const updatedOrder = await order.save();
    res.json(updatedOrder);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

export default router;