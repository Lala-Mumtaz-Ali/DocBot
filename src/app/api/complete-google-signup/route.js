import connectDB from "@/app/lib/db";

import { signupmodel }
from "@/app/lib/models/signupmodel";

import bcrypt from "bcryptjs";

import jwt from "jsonwebtoken";

import nodemailer from "nodemailer";

export async function POST(req) {

  try {

    await connectDB();

    const body =
      await req.json();

    const {
      name,
      email,
      address,
      city,
      contact,
      role,
      password,
      isGoogleUser,
    } = body;

    // ============================================
    // VALIDATION
    // ============================================

    if (
      !name ||
      !email ||
      !address ||
      !city ||
      !contact ||
      !role ||
      !password
    ) {

      return Response.json({
        success: false,

        message:
          "All fields are required",
      });
    }

    // ============================================
    // CHECK EXISTING USER
    // ============================================

    const existingUser =
      await signupmodel.findOne({
        email,
      });

    if (existingUser) {

      return Response.json({
        success: false,

        message:
          "User already exists",
      });
    }

    // ============================================
    // HASH PASSWORD
    // ============================================

    const hashedPassword =
      await bcrypt.hash(
        password,
        10
      );

    // ============================================
    // CREATE USER
    // ============================================

    const user =
      await signupmodel.create({

        name,
        email,
        address,
        city,

        contact,

        role,

        password:
          hashedPassword,

        isGoogleUser:
          isGoogleUser || false,
      });

    // ============================================
    // JWT TOKEN
    // ============================================

    const token =
      jwt.sign(
        {
          id: user._id,
        },

        process.env.JWT_SECRET,

        {
          expiresIn: "7d",
        }
      );

    // ============================================
    // SEND EMAIL
    // ============================================

    const transporter =
      nodemailer.createTransport({

        service: "gmail",

        auth: {

          user:
            process.env.EMAIL_USER,

          pass:
            process.env.EMAIL_PASS,
        },
      });

    await transporter.sendMail({

      from:
        process.env.EMAIL_USER,

      to: email,

      subject:
        "Welcome To DocBot 🎉",

      html: `
        <div style="font-family:sans-serif;padding:20px;">

          <h2>
            Welcome ${name} 🎉
          </h2>

          <p>
            Your DocBot account has been created successfully.
          </p>

          <p>
            Thank you for joining DocBot.
          </p>

        </div>
      `,
    });

    // ============================================
    // RESPONSE
    // ============================================

    return Response.json({

      success: true,

      message:
        "Account created successfully",

      user,

      token,
    });

  } catch (error) {

    console.log(
      "Complete Signup Error:",
      error
    );

    return Response.json({

      success: false,

      message:
        "Server Error",
    });
  }
}