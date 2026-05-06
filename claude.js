exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_API_KEY) {
    console.error("CLAUDE_API_KEY is not set");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "CLAUDE_API_KEY lipsește — adaugă-l în Netlify > Site Settings > Environment Variables" }),
    };
  }

  if (!event.body) {
    return { statusCode: 400, body: JSON.stringify({ error: "Request body is empty" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: "JSON invalid: " + e.message }) };
  }

  const { imageBase64, mediaType, formData } = body;
  if (!imageBase64 || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Lipsește imageBase64 sau mediaType" }) };
  }

  const fd = formData || {};
  const contextLines = [
    fd.numeAgent ? `Numele dat de stăpân: "${fd.numeAgent}"` : '',
    fd.specie ? `Specia: ${fd.specie}` : '',
    fd.nivel ? `Nivel experiență ales: ${fd.nivel}` : '',
    fd.misiune ? `Misiunea aleasă de stăpân: "${fd.misiune}"` : '',
    fd.abilitateUser ? `Abilitatea secretă dată de stăpân: "${fd.abilitateUser}"` : '',
  ].filter(Boolean).join('\n');

  const prompt = `Ești un analist de intelligence cu simț al umorului. Analizează această imagine cu un câine sau pisică și completează un DOSAR SECRET amuzant în română.

${contextLines ? `Date furnizate de stăpân:\n${contextLines}\n\nFolosește aceste date ca bază și completează ce lipsește cu creativitate.` : ''}

Răspunde DOAR cu un obiect JSON valid, fără markdown, fără backticks, fără text în afara JSON-ului:

{
  "numeCod": "Nume de cod spy amuzant și dramatic (ex: VULPEA NEAGRĂ, LABA DE OȚEL, BROTĂCELUL FURIOS)",
  "specie": "câine sau pisică (folosește datele stăpânului dacă sunt disponibile)",
  "rasa": "rasa animalului sau 'Nedeterminată / Clasificat' dacă nu e clară",
  "misiunePrincipala": "misiunea aleasă sau generată amuzant în 10-15 cuvinte",
  "abilitateSpeciala": "abilitatea dată de stăpân sau generată amuzant în 8-12 cuvinte",
  "nivelAmenintare": "unul din: RIDICOL / MODERAT / RIDICAT / EXTREM / CLASIFICAT",
  "codDosar": "număr dosar format HDG-2026-XXXX unde XXXX e random 4 cifre",
  "taglineSecret": "un tagline dramatic și amuzant de 5-8 cuvinte"
}`;

  try {
    console.log("Calling Claude API with model claude-3-5-sonnet-20241022...");

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    console.log("Claude API response status:", response.status);

    // Read body as text first to avoid empty body issues
    const responseText = await response.text();
    console.log("Claude raw response (first 300 chars):", responseText.substring(0, 300));

    if (!responseText || responseText.trim() === "") {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Claude API a returnat un răspuns gol" }),
      };
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Răspuns invalid de la Claude: " + responseText.substring(0, 200) }),
      };
    }

    if (!response.ok) {
      console.error("Claude API error:", data);
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || "Claude API error: " + JSON.stringify(data) }),
      };
    }

    const rawText = data.content?.[0]?.text || "";
    console.log("Claude text response:", rawText.substring(0, 300));

    if (!rawText) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Claude nu a returnat text în răspuns" }),
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from text
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (e2) {
          return {
            statusCode: 500,
            body: JSON.stringify({ error: "Nu s-a putut parsa JSON din răspunsul Claude: " + rawText.substring(0, 200) }),
          };
        }
      } else {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Claude nu a returnat JSON valid: " + rawText.substring(0, 200) }),
        };
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    };

  } catch (err) {
    console.error("Fetch error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Eroare de rețea: " + err.message }),
    };
  }
};
