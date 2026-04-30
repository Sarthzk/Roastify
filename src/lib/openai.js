const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export async function getRoast(input, type = "github") {
  const res = await fetch(`${API_BASE_URL}/api/roast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ input, type }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error ?? `Request failed with status ${res.status}`);
  }

  if (!payload?.roast || !Array.isArray(payload?.tips)) {
    throw new Error("Invalid response format from backend.");
  }

  return payload;
}