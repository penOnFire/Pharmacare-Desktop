import express from "express";
import PDFDocument from "pdfkit";
import Patient from "../models/Patient.js";

const router = express.Router();

router.get("/patient", async (req, res) => {
    try {
        const role = req.query.role || "pharmacist";
        const patients = await Patient.find().lean();

        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=patient_report.pdf");
        doc.pipe(res);

        // Header
        doc.fontSize(20).text("Patient Records Report", { align: "center" });
        doc.moveDown();
        doc.fontSize(12).text(`Generated For: ${role.toUpperCase()}`);
        doc.text(`Generated At: ${new Date().toLocaleString()}`);
        doc.moveDown();

        patients.forEach(p => {
            doc.fontSize(13).text(`${p.firstName} ${p.lastName}`);
            doc.fontSize(11);
            doc.text(`Patient ID: ${p.patientId}`);
            doc.text(`Age: ${p.age}`);
            doc.text(`Gender: ${p.gender || "N/A"}`);
            doc.text(`Contact: ${p.contact || "N/A"}`);
            doc.text(`Last Visit: ${p.lastVisit || "N/A"}`);
            doc.moveDown();
        });

        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).json({
            message: "Error generating patient report",
            error: err
        });
    }
});

export default router;
