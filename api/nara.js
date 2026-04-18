export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  };

  try {
    const body = await req.json();
    const { system, messages, max_tokens } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Invalid request' }),
        { status: 400, headers }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'API key not configured' }),
        { status: 500, headers }
      );
    }

    // Convert Anthropic-style messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const requestBody = {
      systemInstruction: {
        parts: [{ text: system || '' }],
      },
      contents,
      generationConfig: {
        maxOutputTokens: Math.min(max_tokens || 800, 1200),
        temperature: 0.85,
        topP: 0.95,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    };

    // Model fallback — sama seperti Inarte
    const models = [
      'gemini-2.0-flash-001',
      'gemini-2.0-flash',
      'gemini-2.5-flash',
    ];

    const errors = [];

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (response.status === 429 || response.status === 503) {
          errors.push(`${model}: ${response.status}`);
          continue;
        }

        if (!response.ok) {
          const errText = await response.text();
          errors.push(`${model}: ${response.status}`);
          console.error(`${model} error:`, response.status, errText);
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || null;

        if (!text) {
          errors.push(`${model}: empty response`);
          continue;
        }

        // Return in Anthropic-compatible format
        // so the HTML client code doesn't need to change
        return new Response(
          JSON.stringify({ content: [{ type: 'text', text }] }),
          { status: 200, headers }
        );

      } catch (fetchErr) {
        errors.push(`${model}: ${fetchErr.message}`);
        continue;
      }
    }

    console.error('All Gemini models failed:', errors);
    return new Response(
      JSON.stringify({ error: 'AI unavailable', details: errors }),
      { status: 503, headers }
    );

  } catch (err) {
    console.error('Edge function error:', err);
    return new Response(
      JSON.stringify({ error: 'Internal error' }),
      { status: 500, headers }
    );
  }
}
