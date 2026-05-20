exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { imageData, mediaType } = JSON.parse(event.body);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageData } },
            { type: 'text', text: `Analiza esta etiqueta de producto cárnico. Extrae SOLO un JSON con estas claves exactas:
- "tipo": uno de ["Res / ternera","Pollo","Cerdo","Pescado","Mariscos","Embutidos","Otro"]
- "desc": descripción corta del corte o producto (máx 30 chars, en español)
- "fecha": fecha de vencimiento en formato YYYY-MM-DD (DLC, caducidad, best before, use by, etc.)
Si no puedes detectar algún campo, ponlo como null. Responde SOLO el JSON sin texto extra ni backticks.` }
          ]
        }]
      })
    });

    const data = await response.json();
    const text = data.content?.find(b => b.type === 'text')?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(text.replace(/```json|```/g,'').trim()); } catch { parsed = {}; }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };
  } catch(e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
