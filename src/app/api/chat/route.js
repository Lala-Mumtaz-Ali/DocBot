import { NextResponse } from 'next/server';

export async function POST(req) {
    try {
        const { message, history } = await req.json();

        if (!message) {
            return NextResponse.json({ error: 'Message is required' }, { status: 400 });
        }

        console.log("Received message:", message);
        console.log("Forwarding to Python backend: http://127.0.0.1:8000/chat");

        try {
            const pythonResponse = await fetch('http://127.0.0.1:8000/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message: message,
                    history: history || []
                }),
            });

            if (!pythonResponse.ok) {
                const errorText = await pythonResponse.text();
                console.error("Python backend error:", pythonResponse.status, errorText);
                return NextResponse.json({
                    reply: "I'm having trouble connecting to my brain (Python Backend Error). Please check the server logs."
                });
            }

            const data = await pythonResponse.json();

            if (data.debug_info) {
                console.log("\n--- RETRIEVAL DEBUG INFO (from Python) ---");
                data.debug_info.forEach((item, index) => {
                    console.log(`Doc ${index + 1}: Score=${item.bert_score?.toFixed(4) ?? 'N/A'} | Source=${item.source || 'Unknown'}`);
                    console.log(`Preview: ${item.content}...`);
                });
                console.log("------------------------------------------\n");
            }

            return NextResponse.json(data);

        } catch (fetchError) {
            console.error("Failed to connect to Python backend:", fetchError);
            return NextResponse.json({
                reply: "I cannot reach my AI service. Please ensure the Python backend is running on port 8000."
            });
        }

    } catch (error) {
        console.error("Chat API Error:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
