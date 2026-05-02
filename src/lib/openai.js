export async function getRoast(url, type, severity = "medium") {
  const res = await fetch("/api/roast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, type, severity })
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch roast: ${res.statusText}`);
  }

  return res.json();
}