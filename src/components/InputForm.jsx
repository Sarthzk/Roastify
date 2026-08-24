import { useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PERSONAS } from "../lib/personas";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// Order matches the design handoff: the two URL sources adjacent, then the two PDF
// sources adjacent, so the input area never changes kind between neighbouring cards.
const PROFILE_TYPES = [
  { value: "github", index: "01", name: "github", kind: "link", label: "Profile URL", placeholder: "https://github.com/username" },
  { value: "instagram", index: "02", name: "instagram", kind: "link", label: "Profile URL", placeholder: "https://instagram.com/username" },
  {
    value: "linkedin",
    index: "03",
    name: "linkedin",
    kind: "pdf",
    label: "Profile PDF",
    hint: "Open your LinkedIn profile → More → Save to PDF",
    dropLabel: "drop your linkedin pdf",
    pastePlaceholder: "…or paste the text of your profile here.",
  },
  {
    value: "resume",
    index: "04",
    name: "resume",
    kind: "pdf",
    label: "Resume PDF",
    hint: "PDF works best. Plain text is fine too.",
    dropLabel: "drop your resume pdf",
    pastePlaceholder: "…or paste your resume text here.",
  },
];

const SEVERITIES = [
  { value: "mild", note: "gentle" },
  { value: "medium", note: "honest" },
  { value: "destroy me", note: "no mercy" },
];

// Dev-only comparison options — production always uses the server's pinned default
// (see resolveProductionSafeModelOption in api/roast.js) regardless of what's sent.
const MODELS = [
  { value: "gpt-oss-120b", label: "GPT-OSS 120B" },
  { value: "gpt-4o", label: "GPT-4o" },
];

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
}) {
  const [fileInfo, setFileInfo] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef(null);

  const visibleTypes = instagramEnabled ? PROFILE_TYPES : PROFILE_TYPES.filter((t) => t.value !== "instagram");
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

  function handleKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
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
      setFileInfo({ name: fileName, chars: trimmedText.length });
      setUploadStatus(`extracted ${trimmedText.length} characters from ${fileName}`);
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

  return (
    <div className="input-form">
      {/* 4. Source row */}
      <section className="row">
        <div className="row-label">Source</div>
        <div className="source-grid">
          {visibleTypes.map((t) => {
            const selected = type === t.value;
            return (
              <button
                key={t.value}
                type="button"
                className={`source-card${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onTypeChange(t.value)}
              >
                <span className="source-card-bar" />
                <span className="source-card-meta">
                  <span className="source-card-index">{t.index}</span>
                  <span className="source-card-kind">{t.kind}</span>
                </span>
                <span className="source-card-name">{t.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 5. Input row */}
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
              <span className="cmd-hint">cmd + enter</span>
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
                  <span className="file-chars">{fileInfo.chars.toLocaleString()} chars extracted</span>
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

      {/* 6. Voice row — persona + severity */}
      <section className="voice">
        <div className="row-label">Voice</div>
        <div className="persona-col">
          <div className="voice-header">Persona</div>
          {PERSONAS.map((p, i) => {
            const selected = persona === p.value;
            return (
              <button
                key={p.value}
                type="button"
                className={`stack-cell${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onPersonaChange(p.value)}
              >
                <span className="stack-cell-bar" />
                <span className="persona-cell-top">
                  <span className="persona-cell-index">{String(i + 1).padStart(2, "0")}</span>
                  <span className="persona-cell-name">{p.name}</span>
                </span>
                <span className="persona-cell-note">{p.tagline}</span>
              </button>
            );
          })}
        </div>
        <div className="severity-col">
          <div className="voice-header">Severity</div>
          {SEVERITIES.map((sv) => {
            const selected = severity === sv.value;
            return (
              <button
                key={sv.value}
                type="button"
                className={`stack-cell${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onSeverityChange(sv.value)}
              >
                <span className="stack-cell-bar" />
                <span className="severity-cell-name">{sv.value}</span>
                <span className="severity-cell-note">{sv.note}</span>
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
