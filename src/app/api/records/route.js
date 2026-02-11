// import { NextResponse } from "next/server";
// import jwt from "jsonwebtoken";
// import connectDB from "@/app/lib/db"; // ✅ default import
// import Record from "@/app/lib/models/recordModel";

// const SECRET = process.env.JWT_SECRET || "supersecretkey";

// // Verify JWT
// async function verifyToken(req) {
//   const authHeader = req.headers.get("authorization");
//   if (!authHeader) throw new Error("Unauthorized - Missing token");
//   const token = authHeader.split(" ")[1];
//   try {
//     return jwt.verify(token, SECRET);
//   } catch {
//     throw new Error("Unauthorized - Invalid or expired token");
//   }
// }

// // POST — Add new record (handle FormData file upload)
// export async function POST(req) {
//   try {
//     await connectDB();
//     const userData = await verifyToken(req);

//     // Parse form-data
//     const formData = await req.formData();
//     const file = formData.get("file");
//     if (!file) {
//       return NextResponse.json(
//         { success: false, message: "No file provided" },
//         { status: 400 }
//       );
//     }

//     // Determine file type
//     const fileType = file.type.startsWith("image") ? "image" : "pdf";
//     const fileUrl = URL.createObjectURL(file); // For frontend preview
//     const safeFileName = file.name.replace(/[^\w\s.-]/gi, "").trim();

//     const record = await Record.create({
//       userId: userData.id,
//       fileName: safeFileName,
//       fileUrl,
//       fileType,
//     });

//     return NextResponse.json({ success: true, record }, { status: 201 });
//   } catch (error) {
//     console.error("❌ Record POST Error:", error);
//     return NextResponse.json(
//       { success: false, message: error.message || "Internal Server Error" },
//       { status: 500 }
//     );
//   }
// }

// // GET — Fetch user’s records
// export async function GET(req) {
//   try {
//     await connectDB();
//     const userData = await verifyToken(req);

//     const records = await Record.find({ userId: userData.id }).sort({
//       uploadedAt: -1,
//     });

//     return NextResponse.json({ success: true, records }, { status: 200 });
//   } catch (error) {
//     console.error("❌ Record GET Error:", error);
//     return NextResponse.json(
//       { success: false, message: error.message || "Unauthorized" },
//       { status: 401 }
//     );
//   }
// }

// // DELETE — Remove record
// export async function DELETE(req) {
//   try {
//     await connectDB();
//     const userData = await verifyToken(req);
//     const { recordId } = await req.json();

//     if (!recordId) {
//       return NextResponse.json(
//         { success: false, message: "Missing record ID" },
//         { status: 400 }
//       );
//     }

//     const deleted = await Record.findOneAndDelete({
//       _id: recordId,
//       userId: userData.id,
//     });

//     if (!deleted) {
//       return NextResponse.json(
//         { success: false, message: "Record not found" },
//         { status: 404 }
//       );
//     }

//     return NextResponse.json(
//       { success: true, message: "Record deleted successfully" },
//       { status: 200 }
//     );
//   } catch (error) {
//     console.error("❌ Record DELETE Error:", error);
//     return NextResponse.json(
//       { success: false, message: error.message },
//       { status: 500 }
//     );
//   }
// }
import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/app/lib/db";
import Record from "@/app/lib/models/recordModel";
import fs from "fs";
import path from "path";

const SECRET = process.env.JWT_SECRET || "supersecretkey";

// ✅ Verify JWT
async function verifyToken(req) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) throw new Error("Unauthorized - Missing token");
  const token = authHeader.split(" ")[1];
  try {
    return jwt.verify(token, SECRET);
  } catch {
    throw new Error("Unauthorized - Invalid or expired token");
  }
}

// ✅ POST (upload)
export async function POST(req) {
  try {
    await connectDB();
    const userData = await verifyToken(req);
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file) {
      return NextResponse.json({ success: false, message: "No file provided" }, { status: 400 });
    }

    // Check file size (limit: 10MB)
    const MAX_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ success: false, message: "File too large (Max 10MB)" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const safeFileName = file.name.replace(/[^\w\s.-]/gi, "");

    const fileType = file.type.includes("pdf") ? "pdf" : "image";

    // Create record with file data
    const record = await Record.create({
      userId: userData.id,
      fileName: safeFileName,
      fileData: buffer, // Store binary
      fileType,
    });

    // Return record without the heavy buffer
    const recordObj = record.toObject();
    delete recordObj.fileData;

    return NextResponse.json({ success: true, record: recordObj }, { status: 201 });
  } catch (err) {
    console.error("❌ POST Error:", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

// ✅ GET (fetch all)
export async function GET(req) {
  try {
    await connectDB();
    const userData = await verifyToken(req);

    // Exclude fileData from the list to improve performance
    const records = await Record.find({ userId: userData.id })
      .select("-fileData")
      .sort({ uploadedAt: -1 });

    return NextResponse.json({ success: true, records }, { status: 200 });
  } catch (err) {
    console.error("❌ GET Error:", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 401 });
  }
}

// ✅ DELETE
export async function DELETE(req) {
  try {
    await connectDB();
    const userData = await verifyToken(req);
    const { recordId } = await req.json();

    const record = await Record.findOneAndDelete({ _id: recordId, userId: userData.id });
    if (!record) return NextResponse.json({ success: false, message: "Not found" }, { status: 404 });

    return NextResponse.json({ success: true, message: "Deleted successfully" }, { status: 200 });
  } catch (err) {
    console.error("❌ DELETE Error:", err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
