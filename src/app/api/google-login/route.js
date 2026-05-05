import { OAuth2Client } from "google-auth-library";

import connectDB from "@/app/lib/db";

import { signupmodel }
from "@/app/lib/models/signupmodel";

import jwt from "jsonwebtoken";

const client =
  new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID
  );

export async function POST(req) {

  try {

    await connectDB();

    const body =
      await req.json();

    // ============================================
    // VERIFY GOOGLE TOKEN
    // ============================================

    const ticket =
      await client.verifyIdToken({

        idToken:
          body.token,

        audience:
          process.env.GOOGLE_CLIENT_ID,
      });

    const payload =
      ticket.getPayload();

    const {
      email,
      name,
    } = payload;

    // ============================================
    // CHECK USER
    // ============================================

    const existingUser =
      await signupmodel.findOne({
        email,
      });

    // ============================================
    // USER EXISTS → LOGIN
    // ============================================

    if (existingUser) {

      const token =
        jwt.sign(
          {
            id:
              existingUser._id,
          },

          process.env.JWT_SECRET,

          {
            expiresIn: "7d",
          }
        );

      return Response.json({
        success: true,

        isNewUser: false,

        token,

        user:
          existingUser,
      });
    }

    // ============================================
    // NEW USER
    // ============================================

    return Response.json({
      success: true,

      isNewUser: true,

      googleData: {
        name,
        email,
      },
    });

  } catch (error) {

    console.log(
      "Google Auth Error:",
      error
    );

    return Response.json({
      success: false,

      message:
        "Google Authentication Failed",
    });
  }
}