import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import Inventory from '../models/Inventory.js';
import Medicine from '../models/Medicine.js';
import User from '../models/User.js';
import Supplier from '../models/Supplier.js'; // Correct Import
import Order from '../models/Order.js';
import BillingProduct from '../models/BillingProduct.js';

const router = express.Router();

// @route   GET /api/inventory
// @desc    Get all ACTIVE inventory items, with filters
// @access  Private/Admin
router.get('/', protect, async (req, res) => {
  try {
    let query = { isArchived: false };
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // --- Status Filter Logic ---
    if (req.query.status) {
      switch (req.query.status) {
        case 'inStock':
          query.$expr = { $gt: ["$quantity", "$minStockLevel"] };
          query.expiryDate = { $gte: today };
          break;
        case 'lowStock':
          query.$expr = { $lte: ["$quantity", "$minStockLevel"] };
          query.quantity = { $gt: 0 };
          query.expiryDate = { $gte: today };
          break;
        case 'outOfStock':
          query.quantity = 0;
          query.expiryDate = { $gte: today };
          break;
        case 'expired':
          query.expiryDate = { $lt: today };
          break;
      }
    }

    // --- Name Search Logic ---
    if (req.query.name) {
      const medicines = await Medicine.find({
        name: { $regex: req.query.name, $options: 'i' },
      });
      const medicineIds = medicines.map(m => m._id);
      query.medicine = { $in: medicineIds };
    }

    // FIX: Populating 'supplier' instead of 'manufacturer'
    // Ensure your Medicine Schema has "ref: 'Supplier'" for this to work perfectly.
    const inventoryItems = await Inventory.find(query).populate({
      path: 'medicine',
      populate: {
        path: 'supplier', // Changed from manufacturer
        model: 'Supplier', // Changed from Manufacturer
      },
    });
    
    res.json(inventoryItems);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   GET /api/inventory/archived
// @desc    Get all ARCHIVED inventory items
// @access  Private/Admin
router.get('/archived', protect, async (req, res) => {
  try {
    const archivedItems = await Inventory.find({ isArchived: true })
      .populate({
        path: 'medicine',
        populate: {
          path: 'supplier', // Changed
          model: 'Supplier', // Changed
        },
      });
    res.json(archivedItems);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   POST /api/inventory
// @desc    Add a new inventory batch (and create medicine/supplier if new)
// @access  Private/Admin
router.post('/', protect, async (req, res) => {
  try {
    // Inside router.post('/', ...)

    const {
      medicineId, // We are receiving an ID now
      batchNumber,
      quantity,
      costPrice,    // Now expecting costPrice
      sellingPrice, 
      expiryDate,
      supplier,
      minStockLevel,
    } = req.body;

    // 1. Verify the Medicine Exists
    const medicine = await Medicine.findById(medicineId);
    if (!medicine) {
        return res.status(404).json({ message: "Selected medicine not found in database." });
    }

    // 2. Create the Inventory Batch directly linked to that ID
    const newInventoryItem = new Inventory({
      medicine: medicine._id, // Link directly using the ID
      batchNumber,
      expiryDate: expiryDate || null,
      quantity,
      costPrice,
      sellingPrice, 
      minStockLevel,
      isArchived: false,
    });

    await newInventoryItem.save();

    // 3. Return the result
    const populatedItem = await Inventory.findById(newInventoryItem._id).populate({
      path: 'medicine',
      populate: { path: 'supplier' }
    });
    
    res.status(201).json(populatedItem);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   PUT /api/inventory/:id
// @desc    Update an inventory item (Stock, Price, Batch)
// @access  Private/Admin
router.put('/:id', protect, async (req, res) => {
  try {
    const {
      medicineId, // The ID from the dropdown
      batchNumber,
      quantity,
      costPrice,
      sellingPrice,
      expiryDate,
      minStockLevel
    } = req.body;

    const inventoryItem = await Inventory.findById(req.params.id);
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    // 1. Update Inventory Fields
    // If medicineId is provided, verify it exists before switching
    if (medicineId) {
        const medicineExists = await Medicine.findById(medicineId);
        if (medicineExists) {
            inventoryItem.medicine = medicineId;
        }
    }

    inventoryItem.batchNumber = batchNumber || inventoryItem.batchNumber;
    inventoryItem.quantity = quantity !== undefined ? quantity : inventoryItem.quantity;
    
    // Handle price updates safely
    if (sellingPrice !== undefined) inventoryItem.sellingPrice = sellingPrice;
    if (costPrice !== undefined) inventoryItem.costPrice = costPrice;
    
    inventoryItem.expiryDate = expiryDate || inventoryItem.expiryDate;
    inventoryItem.minStockLevel = minStockLevel || inventoryItem.minStockLevel;

    // 2. Save Updates
    await inventoryItem.save();

    // 3. Return Populated Data
    const populatedItem = await Inventory.findById(inventoryItem._id).populate({
      path: 'medicine',
      populate: { path: 'supplier' }, 
    });
    
    res.json(populatedItem);

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   PATCH /api/inventory/:id/archive
// @desc    Archive an inventory item (soft delete)
// @access  Private/Admin
router.patch('/:id/archive', protect, async (req, res) => {
  try {
    const inventoryItem = await Inventory.findById(req.params.id);
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }
    inventoryItem.isArchived = true;
    await inventoryItem.save();
    res.json({ message: 'Item archived successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   PATCH /api/inventory/:id/restore
// @desc    Restore an inventory item
// @access  Private/Admin
router.patch('/:id/restore', protect, async (req, res) => {
  try {
    const inventoryItem = await Inventory.findById(req.params.id);
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }
    inventoryItem.isArchived = false;
    await inventoryItem.save();
    res.json({ message: 'Item restored successfully' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   DELETE /api/inventory/:id
// @desc    Permanently delete an inventory item
// @access  Private/Admin
router.delete('/:id', protect, async (req, res) => {
  try {
    // --- ADDED SUDO CHECK ---
    // NOTE: Front-end must send 'adminPassword' in the request body for this to work
    // If your frontend logic doesn't support it yet, you might want to comment this block out temporarily.
    // const { adminPassword } = req.body;
    // if (!adminPassword) {
    //   return res.status(400).json({ message: 'Admin password is required' });
    // }
    // const adminUser = await User.findById(req.user._id);
    // if (!adminUser || !(await adminUser.matchPassword(adminPassword))) {
    //   return res.status(401).json({ message: 'Invalid admin password. Action canceled.' });
    // }
    // --- END SUDO CHECK ---

    const inventoryItem = await Inventory.findById(req.params.id);
    if (!inventoryItem) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }
    
    // Optional Safety Check: Ensure item is archived first
    // if (!inventoryItem.isArchived) {
    //    return res.status(400).json({ message: 'Item must be archived before deletion.' });
    // }

    await Inventory.deleteOne({ _id: req.params.id });
    res.json({ message: 'Inventory item permanently removed' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   DELETE /api/inventory/archive/all
// @desc    Permanently delete ALL archived items (Sudo required)
// @access  Private/Admin
router.delete('/archive/all', protect, async (req, res) => {
  try {
    //const { adminPassword } = req.body;
    // Uncomment checks when frontend supports password confirmation
    // if (!adminPassword) return res.status(400).json({ message: 'Admin password is required' });

    const deleteResult = await Inventory.deleteMany({ isArchived: true });

    res.json({ 
      message: 'Archive cleared successfully',
      deletedCount: deleteResult.deletedCount 
    });
  
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: err.message || 'Server Error' });
  }
});

// @route   POST /api/inventory/sync-billing
// @desc    Run this ONCE to fill the BillingProduct collection
router.post('/sync-billing', async (req, res) => {
    try {
        // 1. Clear the old collection to avoid duplicates
        await BillingProduct.deleteMany({});

        // 2. Fetch all active inventory with Medicine details
        const allInventory = await Inventory.find({ quantity: { $gt: 0 } })
                                            .populate('medicine');

        // 3. Prepare the simplified list
        const bulkOps = allInventory.map(item => {
            if (!item.medicine) return null; // Skip broken records
            
            return {
                insertOne: {
                    document: {
                        name: `${item.medicine.name} ${item.medicine.strength}`, // Combine Name + Strength
                        sellingPrice: item.sellingPrice,
                        inventoryRefId: item._id
                    }
                }
            };
        }).filter(op => op !== null);

        // 4. Save everything at once
        if (bulkOps.length > 0) {
            await BillingProduct.bulkWrite(bulkOps);
        }

        res.json({ message: `Success! Created ${bulkOps.length} billing items.` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Add this AFTER your schema definition, but BEFORE 'const Inventory = ...'


export default router;