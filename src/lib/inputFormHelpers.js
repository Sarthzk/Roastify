// Pure logic pulled out of InputForm.jsx so it's independently testable (see
// InputForm.test.jsx) and so InputForm.jsx itself can stay a component-only export —
// mixing plain function exports into a component file breaks Vite Fast Refresh for it
// (react-refresh/only-export-components).

// Instagram is the only source that can ever be anything but "open" — the kill switch
// (instagramEnabled) outranks the sign-in lock, matching the design: if the scraper is
// down, a signed-in user sees "off" too, not "sign in". This is the actual tier/locked-
// state derivation the source grid renders from, not just a display detail.
export function sourceState(source, { instagramEnabled, signedIn }) {
  if (source.value !== "instagram") return "open";
  if (!instagramEnabled) return "disabled";
  if (!signedIn) return "locked";
  return "open";
}

// Pure classification + failure-message logic for the upload flow, pulled out of
// InputForm.jsx's processFile() so it's testable without a real File/PDF.
export function classifyUploadFile(fileName, fileType) {
  const isPdf = fileName.toLowerCase().endsWith(".pdf") || fileType === "application/pdf";
  const isText = fileName.toLowerCase().endsWith(".txt") || fileType.startsWith("text/");
  return { isPdf, isText, isSupported: isPdf || isText };
}

export function unsupportedFileMessage(fileName) {
  return `"${fileName}" isn't a PDF or text file — try a different file, or paste the text instead.`;
}

export function emptyExtractionMessage(fileName) {
  return `Couldn't find any text in "${fileName}" — try pasting the text instead.`;
}

export function extractionFailedMessage(fileName) {
  return `Couldn't read "${fileName}" — try a different file, or paste the text instead.`;
}
