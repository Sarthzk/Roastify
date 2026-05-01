export async function getRoast(url, type) {
  const res = await fetch("/api/roast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, type }),
  });

  if (!res.ok) throw new Error("Roast failed");
  return res.json();
}