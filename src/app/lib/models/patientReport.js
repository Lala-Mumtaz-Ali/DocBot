import mongoose from "mongoose";

const PatientReportSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },
    report_date: {
      type: String, // ISO date string e.g. "2024-06-15"
      required: true,
    },
    hba1c: {
      type: Number,
      default: null,
    },
    fasting_glucose: {
      type: Number,
      default: null,
    },
    raw_text: {
      type: String,
      default: "",
    },
    source_filename: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true, // adds createdAt, updatedAt
    collection: "patient_reports",
  }
);

// Prevent model re-compilation in Next.js hot-reload
const PatientReport =
  mongoose.models.PatientReport ||
  mongoose.model("PatientReport", PatientReportSchema);

export default PatientReport;
