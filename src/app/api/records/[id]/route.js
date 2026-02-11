import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import connectDB from "@/app/lib/db";
import Record from "@/app/lib/models/recordModel";

const SECRET = process.env.JWT_SECRET || "supersecretkey";

// Helper to verify token (same as main route)
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

export async function GET(req, { params }) {
    try {
        await connectDB();

        // Auth check (optional: if you want public links, remove this)
        // For privacy, we keep it protected
        await verifyToken(req);

        const { id } = params;

        // Find record by ID
        const record = await Record.findById(id);

        if (!record || !record.fileData) {
            return NextResponse.json({ success: false, message: "File not found" }, { status: 404 });
        }

        // Create response with file data
        const headers = new Headers();
        headers.set("Content-Type", record.fileType === "pdf" ? "application/pdf" : "image/jpeg");
        headers.set("Content-Disposition", `inline; filename="${record.fileName}"`);

        return new NextResponse(record.fileData, {
            status: 200,
            headers,
        });

    } catch (err) {
        console.error("❌ File Fetch Error:", err);
        return NextResponse.json({ success: false, message: err.message }, { status: 500 });
    }
}
