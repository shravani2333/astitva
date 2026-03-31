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
            sysInstruction = `You are Disha, an expert Indian Government welfare scheme recommender for rural, non-literate users.
The user's spoken language is: ${uLang}.
User Profile: Name: ${pName}, Age: ${pAge}, Occupation: ${pOcc}.
Database of schemes: ${JSON.stringify(db || [])}.

TASK:
1. Match their problem against EXACT schemes from the database ONLY. Do NOT invent schemes.
2. Select the best 1-2 matching scheme IDs, ordered by highest priority first.
3. Structure your speech as follows:
   - First, present the highest priority scheme: mention it is the top scheme for them and explain its exact benefit from the database.
   - Second, briefly describe any other matching schemes.
   - Finally, end by asking which scheme they want to proceed with (e.g. 'వీటిలో మీకు ఏ పథకం గురించి కావాలి?' in Telugu or 'आपको इनमें से कौन सी योजना चाहिए?' in Hindi).
4. Speak strictly in the requested language (${uLang}).

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
            sysInstruction = `You are Disha, a helpful local rural scheme expert. Be extremely empathetic and concise. Do not use markdown.
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
                    temperature: 0.1,
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
        
        const startIndex = rawReply.indexOf('{');
        const endIndex = rawReply.lastIndexOf('}');
        
        if (startIndex === -1 || endIndex === -1) {
            throw new Error("No valid JSON object found in AI response");
        }
        
        // Isolate exactly the JSON part, dropping any markdown blocks or conversational text
        let jsonStr = rawReply.substring(startIndex, endIndex + 1);
        
        let parsedReply;
        try {
            parsedReply = JSON.parse(jsonStr);
        } catch(parseErr) {
            // If the AI accidentally left literal unescaped newlines inside the JSON strings,
            // we safely replace ALL newlines with spaces. This preserves valid JSON structure.
            let safeJsonStr = jsonStr.replace(/\n/g, ' ').replace(/\r/g, '');
            parsedReply = JSON.parse(safeJsonStr);
        }
        
        // Return exactly what Gemini formatted as JSON natively
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(parsedReply)
        };
    } catch (error) {
        return { statusCode: 500, body: JSON.stringify({ error: "Server error: " + error.message }) };
    }
};
