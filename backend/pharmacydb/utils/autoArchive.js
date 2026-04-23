import Inventory from '../models/Inventory.js';
import ActivityLog from '../models/ActivityLog.js';

export const checkAndArchiveExpired = async () => {
    try {
        const today = new Date();
        
        // Find all active batches where the expiry date has passed
        const expiredBatches = await Inventory.find({
            expiryDate: { $lt: today },
            isArchived: false
        }).populate('medicine');

        // If nothing is expired, exit instantly (takes less than 1 millisecond)
        if (expiredBatches.length === 0) return;

        let count = 0;
        for (const batch of expiredBatches) {
            // 1. Move to archive
            batch.isArchived = true;
            await batch.save();
            
            const medName = batch.medicine ? batch.medicine.name : 'Unknown Medicine';

            // 2. Write to Activity Log as the System
            await ActivityLog.create({
                userId: null, 
                userName: 'System Auto-Task',
                userRole: 'System',
                action: 'AUTO_ARCHIVE_EXPIRED',
                module: 'Inventory',
                description: `System automatically archived expired batch '${batch.batchNumber || 'N/A'}' of '${medName}'.`,
                targetId: batch._id.toString(),
                status: 'success'
            });
            
            count++;
        }
        
        console.log(`🧹 [Auto-Archive] Swept ${count} expired batch(es) into the archive.`);

    } catch (err) {
        console.error('❌ [Auto-Archive] Error:', err.message);
    }
};