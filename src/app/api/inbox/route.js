
import { NextResponse } from "next/server";
import mongoose from "mongoose";
import dbConnect from "@/app/lib/db";
import Inbox from "@/app/lib/models/inboxModel";
import Record from "@/app/lib/models/recordModel"; // ✅ import Record

// ==========================
// SEND RECORD TO INBOX
// ==========================
export async function POST(req) {
  try {
    await dbConnect();

    const { senderEmail, receiverEmail, record } = await req.json();

    if (!senderEmail || !receiverEmail || !record)
      return NextResponse.json(
        { message: "senderEmail, receiverEmail and record are required" },
        { status: 400 }
      );

    if (!mongoose.Types.ObjectId.isValid(record))
      return NextResponse.json({ message: "Invalid record ID" }, { status: 400 });

    const newInbox = await Inbox.create({ senderEmail, receiverEmail, record });

    return NextResponse.json(
      { success: true, message: "Record sent successfully", data: newInbox },
      { status: 201 }
    );
  } catch (error) {
    console.error("POST INBOX ERROR:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==========================
// FETCH INBOX FOR RECEIVER
// ==========================
export async function GET(req) {
  try {
    await dbConnect();

    const { searchParams } = new URL(req.url);
    const receiverEmail = searchParams.get("receiverEmail");

    if (!receiverEmail)
      return NextResponse.json(
        { message: "receiverEmail query param is required" },
        { status: 400 }
      );

    const inboxData = await Inbox.find({ receiverEmail })
      .populate("record") // ✅ fetch full record data
      .sort({ createdAt: -1 });

    return NextResponse.json(
      { success: true, count: inboxData.length, data: inboxData },
      { status: 200 }
    );
  } catch (error) {
    console.error("GET INBOX ERROR:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}

// ==========================
// DELETE INBOX ITEM (OPTIONAL)
// ==========================
export async function DELETE(req) {
  try {
    await dbConnect();
    const { inboxId } = await req.json();

    if (!mongoose.Types.ObjectId.isValid(inboxId))
      return NextResponse.json({ message: "Invalid inbox ID" }, { status: 400 });

    await Inbox.findByIdAndDelete(inboxId);

    return NextResponse.json({ success: true, message: "Inbox item deleted" });
  } catch (error) {
    console.error("DELETE INBOX ERROR:", error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
