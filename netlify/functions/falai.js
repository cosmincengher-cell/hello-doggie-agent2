exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const FALAI_API_KEY = process.env.FALAI_API_KEY;
  if (!FALAI_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "Missing FALAI_API_KEY" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const { imageBase64, mediaType, numeCod, specie } = body;
  if (!imageBase64 || !mediaType) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing image data" }) };
  }

  // Convert base64 to data URL for fal.ai
  const imageDataUrl = `data:${mediaType};base64,${imageBase64}`;

  const prompt = `Transform this ${specie || "pet"} photo into a cinematic spy thriller portrait. 
Style: Film noir, secret agent dossier photo, high contrast black and white with deep shadows, 
dramatic side lighting, moody atmosphere like a 1960s spy film. 
The animal should remain clearly recognizable and be the main subject.
Add subtle vignette effect, film grain, and cinematic quality.
The ${specie || "animal"} known as agent "${numeCod || "UNKNOWN"}" should look mysterious and important.
Keep the animal's face and distinctive features clearly visible.`;

  try {
    // Submit job to fal.ai flux-kontext for image-to-image
    const submitResponse = await fetch("https://queue.fal.run/fal-ai/flux/dev/image-to-image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Key ${FALAI_API_KEY}`,
      },
      body: JSON.stringify({
        image_url: imageDataUrl,
        prompt: prompt,
        strength: 0.75,
        num_inference_steps: 28,
        guidance_scale: 3.5,
        num_images: 1,
        image_size: "square_hd",
      }),
    });

    const submitData = await submitResponse.json();

    if (!submitResponse.ok) {
      return {
        statusCode: submitResponse.status,
        body: JSON.stringify({ error: submitData.detail || submitData.message || "fal.ai submit error" }),
      };
    }

    // If we got a direct result (sync response)
    if (submitData.images && submitData.images[0]) {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: submitData.images[0].url }),
      };
    }

    // Poll for result if async
    const requestId = submitData.request_id;
    if (!requestId) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No request_id from fal.ai" }),
      };
    }

    // Poll up to 60 seconds
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));

      const statusResponse = await fetch(
        `https://queue.fal.run/fal-ai/flux/dev/image-to-image/requests/${requestId}`,
        {
          headers: { Authorization: `Key ${FALAI_API_KEY}` },
        }
      );

      const statusData = await statusResponse.json();

      if (statusData.status === "COMPLETED" || (statusData.images && statusData.images[0])) {
        const imageUrl = statusData.images?.[0]?.url || statusData.output?.images?.[0]?.url;
        if (imageUrl) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageUrl }),
          };
        }
      }

      if (statusData.status === "FAILED") {
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "fal.ai job failed" }),
        };
      }
    }

    return {
      statusCode: 504,
      body: JSON.stringify({ error: "fal.ai timeout after 60s" }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
