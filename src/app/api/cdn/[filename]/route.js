import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Simple MIME type map to avoid external dependencies
const getMimeType = (ext) => {
    const map = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".txt": "text/plain",
    };
    return map[ext.toLowerCase()] || "application/octet-stream";
};

export async function GET(req, { params }) {
    const { filename } = await params;

    if (!filename) {
        return NextResponse.json({ error: "Filename required" }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "public", "uploads", filename);

    if (!fs.existsSync(filePath)) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    const ext = path.extname(filename);
    const contentType = getMimeType(ext);

    const url = new URL(req.url);
    const isDownload = url.searchParams.get("download") === "true";

    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set(
        "Content-Disposition",
        `${isDownload ? "attachment" : "inline"}; filename="${filename}"`
    );
    headers.set("Cache-Control", "public, max-age=3600");

    return new NextResponse(fileBuffer, {
        status: 200,
        headers,
    });
}
