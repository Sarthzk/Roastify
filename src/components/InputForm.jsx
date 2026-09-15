import { useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PERSONAS } from "../lib/personas";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// Order matches the v3 design: the three open sources first, instagram (the only one
// that can be locked or disabled) last — a source is never hidden, so this ordering
// doesn't need to keep link/pdf kinds adjacent the way the old 4-card grid did.
const PROFILE_TYPES = [
  { value: "github", name: "github", kind: "link", label: "Profile url", placeholder: "https://github.com/username" },
  {
    value: "linkedin",
    name: "linkedin",
    kind: "pdf",
    label: "Profile pdf",
    hint: "Open your LinkedIn profile → More → Save to PDF",
    dropLabel: "drop your linkedin pdf",
    pastePlaceholder: "…or paste the text of your profile here.",
  },
  {
    value: "resume",
    name: "resume",
    kind: "pdf",
    label: "Resume pdf",
    hint: "PDF works best. Plain text is fine too.",
    dropLabel: "drop your resume pdf",
    pastePlaceholder: "…or paste your resume text here.",
  },
  { value: "instagram", name: "instagram", kind: "link", label: "Profile url", placeholder: "https://instagram.com/username", gated: true },
];

const SEVERITIES = ["mild", "medium", "destroy me"];

// Dev-only comparison options — production always uses the server's pinned default
// (see resolveProductionSafeModelOption in api/roast.js) regardless of what's sent.
const MODELS = [
  { value: "gpt-oss-120b", label: "GPT-OSS 120B" },
  { value: "gpt-4o", label: "GPT-4o" },
];

// Instagram is the only source that can ever be anything but "open" — the kill switch
// (instagramEnabled) outranks the sign-in lock, matching the design: if the scraper is
// down, a signed-in user sees "off" too, not "sign in".
function sourceState(source, { instagramEnabled, signedIn }) {
  if (source.value !== "instagram") return "open";
  if (!instagramEnabled) return "disabled";
  if (!signedIn) return "locked";
  return "open";
}

export default function InputForm({
  url,
  onUrlChange,
  type,
  onTypeChange,
  severity,
  onSeverityChange,
  persona,
  onPersonaChange,
  model,
  onModelChange,
  onSubmit,
  loading,
  instagramEnabled,
  signedIn,
  onSignIn,
}) {
  const [fileInfo, setFileInfo] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Which inline prompt is showing beneath the source grid — null, "locked" (needs
  // sign-in), or "disabled" (kill switch off). Set by clicking a non-open source cell
  // instead of selecting it.
  const [prompt, setPrompt] = useState(null);
  const fileInputRef = useRef(null);

  const active = PROFILE_TYPES.find((t) => t.value === type) || PROFILE_TYPES[0];
  const isUploadType = active.kind === "pdf";

  // Switching source clears whatever was typed/uploaded for the previous one — the file
  // confirmation card and any upload error/status are presentation state local to this
  // component; `url` itself (the actual submitted value) is cleared by the parent's
  // onTypeChange handler. Adjusting state during render (rather than in an effect) per
  // React's own guidance for "reset state when a prop changes" — avoids the extra render
  // pass an effect would cost.
  const [prevType, setPrevType] = useState(type);
  if (type !== prevType) {
    setPrevType(type);
    setFileInfo(null);
    setUploadStatus("");
    setUploadError("");
  }

  // The prompt closes itself once the tier boundary that opened it is no longer in the
  // way — signing in resolves a "locked" prompt (a "disabled" one, the kill switch, is
  // unrelated to sign-in state, but clearing both on sign-in is harmless and simpler
  // than tracking which one is showing).
  const [prevSignedIn, setPrevSignedIn] = useState(signedIn);
  if (signedIn !== prevSignedIn) {
    setPrevSignedIn(signedIn);
    if (signedIn) setPrompt(null);
  }

  function handleKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
  }

  function handleSourceClick(source) {
    const state = sourceState(source, { instagramEnabled, signedIn });
    if (state === "open") {
      onTypeChange(source.value);
      setPrompt(null);
    } else {
      setPrompt(state);
    }
  }

  async function extractPdfText(file) {
    const data = await file.arrayBuffer();
    const document = await pdfjsLib.getDocument({ data }).promise;
    let text = "";

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str ?? "").join(" ");
      text += `${pageText}\n`;
    }

    return text.trim();
  }

  async function processFile(file) {
    setUploadStatus("");
    setUploadError("");

    const fileName = file.name;
    const isPdf = fileName.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const isText = fileName.toLowerCase().endsWith(".txt") || file.type.startsWith("text/");

    if (!isPdf && !isText) {
      setUploadError(`"${fileName}" isn't a PDF or text file — try a different file, or paste the text instead.`);
      return;
    }

    try {
      const extractedText = isPdf ? await extractPdfText(file) : await file.text();
      const trimmedText = extractedText.trim();

      if (!trimmedText) {
        setUploadError(`Couldn't find any text in "${fileName}" — try pasting the text instead.`);
        return;
      }

      onUrlChange(trimmedText);
      setFileInfo({ name: fileName });
      setUploadStatus(`extracted text from ${fileName}`);
    } catch {
      setUploadError(`Couldn't read "${fileName}" — try a different file, or paste the text instead.`);
    }
  }

  function handleFileInputChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) processFile(file);
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) processFile(file);
  }

  function handleDropZoneKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  }

  const promptIsLock = prompt === "locked";

  return (
    <div className="input-form">
      {/* Source row */}
      <section className="row">
        <div className="row-label">Source</div>
        <div>
          <div className="source-grid">
            {PROFILE_TYPES.map((t) => {
              const state = sourceState(t, { instagramEnabled, signedIn });
              const selected = type === t.value && state === "open";
              let tagText = t.kind === "link" ? "link" : "pdf";
              if (state === "locked") tagText = "sign in";
              if (state === "disabled") tagText = "off";
              return (
                <button
                  key={t.value}
                  type="button"
                  className={`source-card${selected ? " is-selected" : ""}${state === "locked" ? " is-locked" : ""}${state === "disabled" ? " is-disabled" : ""}`}
                  disabled={loading}
                  onClick={() => handleSourceClick(t)}
                >
                  <span className="source-card-bar" />
                  <span className="source-card-name">{t.name}</span>
                  <span className="source-card-tag">{tagText}</span>
                </button>
              );
            })}
          </div>

          {prompt && (
            <div className={`source-prompt${promptIsLock ? " is-invitation" : ""}`}>
              <div className="source-prompt-body">
                <span className="source-prompt-mark">{promptIsLock ? "•" : "—"}</span>
                <span className="source-prompt-text">
                  {promptIsLock
                    ? "Instagram needs an account — it's the only source that costs us to run. Sign in and your daily limit goes to 15 as well."
                    : "Instagram is temporarily unavailable. The other three sources are unaffected."}
                </span>
              </div>
              {promptIsLock && (
                <div className="source-prompt-actions">
                  <button type="button" className="source-prompt-provider" onClick={() => onSignIn("github")}>
                    github
                  </button>
                  <button type="button" className="source-prompt-provider" onClick={() => onSignIn("google")}>
                    google
                  </button>
                </div>
              )}
              <button type="button" className="source-prompt-close" onClick={() => setPrompt(null)}>
                close
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Input row */}
      <section className="row">
        <div className="row-label">{active.label}</div>
        <div>
          {!isUploadType && (
            <div className="link-row">
              <span className="link-chevron">&#8250;</span>
              <input
                type="text"
                className="link-input"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={active.placeholder}
                disabled={loading}
              />
            </div>
          )}

          {isUploadType && (
            <div className="file-body">
              <div className="file-hint">
                <span className="file-hint-chevron">&#8250;</span>
                <span>{active.hint}</span>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.txt,application/pdf,text/plain"
                onChange={handleFileInputChange}
                disabled={loading}
                className="hidden"
              />

              {!fileInfo && (
                <div
                  className={`drop${dragging ? " is-dragging" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={handleDropZoneKeyDown}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (!dragging) setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <span className="drop-arrow">&#8595;</span>
                  <span className="drop-label">{dragging ? "release to read it" : active.dropLabel}</span>
                  <span className="drop-browse">click to browse</span>
                </div>
              )}

              {fileInfo && (
                <div className="file-row">
                  <span className="file-check">&#10003;</span>
                  <span className="file-name">{fileInfo.name}</span>
                  <button
                    type="button"
                    className="file-replace"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFileInfo(null);
                      setUploadStatus("");
                    }}
                  >
                    replace
                  </button>
                </div>
              )}

              <div className="paste-divider">
                <span className="paste-divider-label">or paste the text</span>
                <span className="paste-divider-rule" />
              </div>
              <textarea
                className="paste-area"
                value={url}
                onChange={(e) => onUrlChange(e.target.value)}
                onKeyDown={handleKey}
                placeholder={active.pastePlaceholder}
                disabled={loading}
              />

              {uploadError ? (
                <p className="upload-error">{uploadError}</p>
              ) : uploadStatus ? (
                <p className="upload-error" style={{ color: "var(--ink-2)" }}>
                  {uploadStatus}
                </p>
              ) : null}
            </div>
          )}
        </div>
      </section>

      {/* Voice row — persona only, three across */}
      <section className="row">
        <div className="row-label">Voice</div>
        <div className="persona-grid">
          {PERSONAS.map((p) => {
            const selected = persona === p.value;
            return (
              <button
                key={p.value}
                type="button"
                className={`persona-cell${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onPersonaChange(p.value)}
              >
                <span className="persona-cell-bar" />
                <span className="persona-cell-name">{p.name}</span>
                <span className="persona-cell-note">{p.tagline}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Severity row — its own row now, not a column beside persona */}
      <section className="row">
        <div className="row-label">Severity</div>
        <div className="severity-row">
          {SEVERITIES.map((sv) => {
            const selected = severity === sv;
            return (
              <button
                key={sv}
                type="button"
                className={`severity-cell${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onSeverityChange(sv)}
              >
                {sv}
              </button>
            );
          })}
        </div>
      </section>

      {import.meta.env.DEV && (
        <section className="row">
          <div className="row-label">Model (dev)</div>
          <div className="model-grid">
            {MODELS.map((m) => {
              const selected = model === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  className={`source-card${selected ? " is-selected" : ""}`}
                  disabled={loading}
                  onClick={() => onModelChange(m.value)}
                  style={{ minHeight: "56px" }}
                >
                  <span className="source-card-bar" />
                  <span className="source-card-name">{m.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
