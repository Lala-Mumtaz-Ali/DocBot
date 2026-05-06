// src/app/api/update-profile/route.js

import { NextResponse } from "next/server";
import connectDB from "../../lib/db"; // your db connection
import { signupmodel } from "../../lib/models/signupmodel";

export async function PUT(req) {
  try {
    await connectDB();

    const body = await req.json();

    const {
        name,
      email,
      address,
      city,
      contact,
    } = body;

    // ==========================
    // FIND USER BY EMAIL
    // ==========================

    const user = await signupmodel.findOne({ email });

    if (!user) {
      return NextResponse.json({
        success: false,
        message: "User not found",
      });
    }

    // ==========================
    // UPDATE USER INFO
    // ==========================
    user.name = name;
    user.address = address;
    user.city = city;
    user.contact = contact;

    await user.save();

    return NextResponse.json({
      success: true,
      message: "Profile updated successfully",
      user,
    });

  } catch (error) {
    console.log(error);

    return NextResponse.json({
      success: false,
      message: "Server Error",
    });
  }
}