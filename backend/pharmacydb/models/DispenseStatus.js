const mongoose = require("mongoose");

const dispenseStatusSchema = new mongoose.Schema({
    patientId: { type: String, required: true },
    status: {
        type: String,
        enum: ["Pending Dispense", "Completed"],
        default: "Pending Dispense"
    },
    lastPrescriptionDate: { type: Date, required: true },
    updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("DispenseStatus", dispenseStatusSchema);
