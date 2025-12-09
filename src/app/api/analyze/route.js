import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const formData = await req.formData();

        console.log("Analyzing file...");

        // Forward to Python backend
        const pythonResponse = await fetch('http://127.0.0.1:8000/analyze_report', {
            method: 'POST',
            body: formData, // fetch automatically sets the correct Multipart Content-Type
        });

        if (!pythonResponse.ok) {
            const errorText = await pythonResponse.text();
            console.error("Python backend error:", pythonResponse.status, errorText);
            return NextResponse.json({
                reply: "I'm having trouble analyzing the report. Please check the server logs."
            });
        }

        const data = await pythonResponse.json();
        return NextResponse.json(data);

    } catch (error) {
        console.error("Analyze API Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
