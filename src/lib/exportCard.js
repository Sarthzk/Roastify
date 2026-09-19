import html2canvas from "html2canvas";

// Shared by RoastCard.jsx and History.jsx — both call this exact function on a rendered
// VerdictCard node, so a fresh roast's "export card" and a past one's produce pixel-for-
// pixel the same look.
export async function exportCardAsImage(node, filename) {
  const canvas = await html2canvas(node, {
    // html2canvas passes this straight to a canvas fillStyle, which doesn't resolve CSS
    // custom properties — must stay a literal hex (kept in sync with --rs-canvas in
    // src/index.css).
    backgroundColor: "#faf8f5",
    scale: 2,
  });
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL();
  link.click();
}
