exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { imageData, mediaType } = body;

    if (!imageData) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No imageData received' }) };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageData } },
            { type: 'text', text: `Analiza esta imagen. Busca cualquier fecha de vencimiento, caducidad, "consumir antes", "best before", "use by", DLC, o similar.
Responde SOLO este JSON sin texto extra ni backticks:
{"tipo":"Pollo","desc":"descripcion corta","fecha":"YYYY-MM-DD"}
Si no encuentras algún campo ponlo null. La fecha debe estar en formato YYYY-MM-DD.` }
          ]
        }]
      })
    });

    const rawResponse = await response.text();
    console.log('Anthropic raw response:', rawResponse);

    const data = JSON.parse(rawResponse);
    const text = data.content?.find(b => b.type === 'text')?.text || '{}';
    console.log('AI text:', text);

    let parsed;
    try { 
      parsed = JSON.parse(text.replace(/```json|```/g, '').trim()); 
    } catch(e) { 
      parsed = { error: 'parse failed', raw: text };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed)
    };

  } catch(e) {
    console.log('Error:', e.message);
    return { 
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }) 
    };
  }
};
