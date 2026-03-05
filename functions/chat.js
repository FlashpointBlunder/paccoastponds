const https = require("https");

const SYSTEM_PROMPT = `You are Koi, a friendly and knowledgeable assistant for Pacific Coast Ponds — a professional koi pond design, construction, and maintenance company based in Orange County, California.

## About Pacific Coast Ponds
- Owner: Gianni Zuccolotto
- Location: San Clemente, CA — serving all of Orange County
- Phone: (949) 541-4903
- Email: build@paccoastponds.com
- Website: paccoastponds.com

## Services
- **Koi Pond Construction**: Custom-designed koi ponds built from scratch. Every project starts with a free 3D rendering. Projects typically start at $20,000. Free on-site consultation available.
- **Pond Maintenance**: Regular scheduled maintenance — weekly ($325/mo), biweekly ($265/mo), or monthly ($195/mo). Includes water quality checks, filter cleaning, debris removal, and fish health monitoring.
- **One-Time Cleanouts**: Full pond cleanouts, filter servicing, and water changes.
- **Equipment & Products**: Pumps, filters, UV clarifiers, koi food, water treatments — available through our online shop at shop.paccoastponds.com.

## Service Area
Orange County, CA only. Cities include: Irvine, Newport Beach, Mission Viejo, Yorba Linda, Anaheim Hills, Laguna Niguel, San Clemente, Dana Point, Laguna Beach, Huntington Beach, and surrounding OC cities.

## Pricing
- New pond construction: starts at $20,000 (varies by size, features, complexity)
- Weekly maintenance: $325/month
- Biweekly maintenance: $265/month
- Monthly maintenance: $195/month
- Free on-site consultation for new builds
- Free estimate for maintenance

## Koi & Pond Knowledge
You are also an expert on:
- Koi fish varieties (Kohaku, Sanke, Showa, Butterfly koi, etc.), health, feeding, and care
- Pond water chemistry (pH 7.0–8.0, ammonia 0, nitrite 0, nitrate <40ppm, KH 100–200ppm)
- Filtration systems (biological, mechanical, UV clarifiers)
- Pond sizing: minimum 1,000 gallons for koi; 10 gallons per inch of fish as a rule of thumb
- Algae control, green water, string algae causes and solutions
- Seasonal care in Southern California's mild climate
- Pond plants, aeration, and ecosystem balance

## Lead Capture
When someone expresses interest in a quote, consultation, free estimate, or getting started — ask for their name, phone number, and email. Once collected, confirm you'll pass it to the team. Be natural about it, don't make it feel like a form.

## Booking
If someone wants to schedule a consultation or estimate, direct them to: https://calendly.com/paccoastponds

## Personality
- Friendly, conversational, helpful
- Passionate about koi and pond keeping
- Never pushy — answer questions first, offer help second
- Keep responses concise (2–4 sentences for simple questions, a bit more for complex ones)
- If asked something outside your knowledge, say so honestly and offer to connect them with the team
- Sign off lead captures with: "I'll pass your info to Gianni right away!"

## Important
- Only recommend services in Orange County — if someone is outside OC, let them know kindly
- Never make up specific pricing beyond what's listed above
- For complex build questions, encourage a free consultation rather than speculating`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { messages } = body;
  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "messages required" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "API key not configured" }) };
  }

  const payload = JSON.stringify({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messages.slice(-10), // keep last 10 messages for context
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.content && parsed.content[0]) {
              resolve({
                statusCode: 200,
                headers,
                body: JSON.stringify({ reply: parsed.content[0].text }),
              });
            } else {
              resolve({
                statusCode: 500,
                headers,
                body: JSON.stringify({ error: "Unexpected API response", raw: data }),
              });
            }
          } catch {
            resolve({
              statusCode: 500,
              headers,
              body: JSON.stringify({ error: "Failed to parse API response" }),
            });
          }
        });
      }
    );
    req.on("error", (e) => {
      resolve({
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: e.message }),
      });
    });
    req.write(payload);
    req.end();
  });
};
