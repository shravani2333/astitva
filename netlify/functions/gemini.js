exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        return { statusCode: 500, body: JSON.stringify({ error: "API Key missing in environment" }) };
    }

    try {
        const reqBody = JSON.parse(event.body);
        const { query, messages, lang, profile, db } = reqBody;
        
        const isChatMode = !!messages;
        const uLang = lang === 'te' ? 'Telugu' : (lang === 'hi' ? 'Hindi' : 'English');
        const pName = profile?.name || "User";
        const pAge = profile?.age || "Unknown";
        const pOcc = profile?.occ || "Unknown";
        
        let sysInstruction, contentText, jsonResponseSchema;
        
        if (!isChatMode) {
            // VIEW 3 / 4 RAG RECOMMENDER MODE
            sysInstruction = `You are Priya, an expert Indian Government welfare scheme recommender for rural, non-literate users.
The user's spoken language is: ${uLang}.
User Profile: Name: ${pName}, Age: ${pAge}, Occupation: ${pOcc}.
Database of schemes: ${JSON.stringify(db || [])}.

TASK:
1. Match their problem against exact schemes.
2. Select the best 1-2 matching scheme IDs.
3. Write a brief empathetic response explaining how it helps.

CRITICAL: YOU MUST RETURN RAW JSON ONLY.
Required Schema:
{
  "speech": "Your empathetic translated response in native script",
  "speech_phonetic": "The exact same response transliterated into Latin/English (e.g. 'Nenu meku sahayam chestanu'). If english, keep empty.",
  "scheme_ids": ["ID1", "ID2"]
}`;
            contentText = "Query: " + (query || "no text provided");
            jsonResponseSchema = "application/json";
        } else {
            // VIEW 6 EXPERT CHAT MODE
            sysInstruction = `You are Priya, a helpful local rural scheme expert. Be extremely empathetic and concise. Do not use markdown.
The user's spoken language is: ${uLang}.

TASK: Answer the user's specific question about the scheme concisely.
CRITICAL: YOU MUST RETURN RAW JSON ONLY.
Required Schema:
{
  "reply": "Your concise empathetic answer in the native script.",
  "reply_phonetic": "The exact same answer transliterated into Latin/English (e.g. 'Avunu andi, adi nijame'). If english, keep empty."
}`;
            contentText = "Chat Context/Message: " + messages;
            jsonResponseSchema = "application/json";
        }

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                system_instruction: { parts: [{ text: sysInstruction }] },
                contents: [{ parts: [{ text: contentText }] }],
                generationConfig: {
                    temperature: 0.3,
                    responseMimeType: jsonResponseSchema
                }
            })
        });

        const data = await response.json();
        
        if (data.error) {
             return { statusCode: 400, body: JSON.stringify({ error: "API Error: " + data.error.message }) };
        }

        const rawReply = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if(!rawReply) throw new Error("Empty gemini response");
        
        // Return exactly what Gemini formatted as JSON natively
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: rawReply
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server error: " + error.message }) };
    }
};
