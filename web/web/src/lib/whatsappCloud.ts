const WHATSAPP_MAX_BODY = 4096;

export async function sendWhatsAppText(
  to: string,
  body: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    return {
      ok: false,
      error: "Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID.",
    };
  }

  const normalizedTo = to.replace(/\D/g, "");
  if (!normalizedTo) {
    return { ok: false, error: "Recipient phone number is empty after normalization." };
  }

  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v21.0";
  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;
  const textBody =
    body.length > WHATSAPP_MAX_BODY ? `${body.slice(0, WHATSAPP_MAX_BODY - 1)}…` : body;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizedTo,
      type: "text",
      text: { preview_url: false, body: textBody },
    }),
  });

  if (!res.ok) {
    return { ok: false, error: await res.text() };
  }

  return { ok: true };
}
