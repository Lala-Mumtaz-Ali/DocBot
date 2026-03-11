// import mongoose from "mongoose";

// const InboxSchema = new mongoose.Schema(
//   {
//     senderEmail: {
//       type: String,
//       required: true,
//     },

//     receiverEmail: {
//       type: String,
//       required: true,
//     },

//     record: {
//       type: mongoose.Schema.Types.ObjectId,
//       ref: "MedicalRecord",
//       required: true,
//     },

//     isRead: {
//       type: Boolean,
//       default: false,
//     },
//   },
//   { timestamps: true }
// );

// export default mongoose.models.Inbox ||
//   mongoose.model("Inbox", InboxSchema);
import mongoose from "mongoose";

const InboxSchema = new mongoose.Schema(
  {
    senderEmail: { type: String, required: true },
    receiverEmail: { type: String, required: true },
    record: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Record", // ✅ matches your Record model
      required: true,
    },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export default mongoose.models.Inbox ||
  mongoose.model("Inbox", InboxSchema);
