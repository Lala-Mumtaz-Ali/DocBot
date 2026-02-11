import mongoose from "mongoose";

const recordSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    fileData: {
      type: Buffer, // Store binary data
      required: true,
    },
    fileUrl: {
      type: String, // Keep for backward compatibility or direct access if needed
      required: false,
    },
    fileType: {
      type: String,
      required: true,
      enum: ["image", "pdf", "video", "other"],
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const Record =
  mongoose.models.Record || mongoose.model("Record", recordSchema);

export default Record;
