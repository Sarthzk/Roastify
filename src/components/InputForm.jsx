import { useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PERSONAS } from "../lib/personas";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

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
}) {
  // Shared by the resume and linkedin types — both are pasted-text-or-uploaded-file
  // inputs (linkedin via a "Save to PDF" export, since the Apify LinkedIn actor never
  // worked unauthenticated), so they use the same upload/paste UI and extraction logic.
  const [pastedText, setPastedText] = useState(url);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const isUploadType = type === "resume" || type === "linkedin";

  const profileTypes = [
    { value: "github", label: "01 github" },
    { value: "linkedin", label: "02 linkedin" },
    { value: "instagram", label: "03 instagram" },
    { value: "resume", label: "04 resume" },
  ];

  const severities = ["mild", "medium", "destroy me"];

  // Dev-only comparison options — production always uses the server's pinned default
  // (see resolveProductionSafeModelOption in api/roast.js) regardless of what's sent.
  const models = [
    { value: "gpt-oss-120b", label: "GPT-OSS 120B" },
    { value: "gpt-4o", label: "GPT-4o" },
  ];

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

  async function handleFileChange(event) {
    const file = event.target.files?.[0];
    setUploadStatus("");
    setUploadError("");

    if (!file) {
      return;
    }

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

      setPastedText(trimmedText);
      onUrlChange(trimmedText);
      setUploadStatus(`extracted ${trimmedText.length} characters from ${fileName}`);
    } catch {
      setUploadError(`Couldn't read "${fileName}" — try a different file, or paste the text instead.`);
    }
  }

  return (
    <div className="w-full flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Profile Type
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {profileTypes.map(({ value, label }) => {
            const selected = type === value;

            return (
              <button
                key={value}
                onClick={() => onTypeChange(value)}
                disabled={loading}
                style={{
                  backgroundColor: selected ? "var(--color-bg-hover)" : "var(--color-bg-surface)",
                  color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                  borderWidth: "1px",
                  borderLeftWidth: "2px",
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                  borderRadius: "2px",
                  fontFamily: "'Courier New', monospace",
                }}
                className="flex min-h-16 items-center px-4 py-4 text-left text-sm uppercase tracking-[0.2em] transition-colors duration-200"
                onMouseEnter={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                    e.currentTarget.style.borderLeftColor = "var(--color-accent)";
                    e.currentTarget.style.color = "var(--color-accent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-surface)";
                    e.currentTarget.style.borderLeftColor = "var(--color-border)";
                    e.currentTarget.style.color = "var(--color-text-secondary)";
                  }
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          {type === "resume" ? "Resume Text" : type === "linkedin" ? "LinkedIn Profile Text" : "Profile URL"}
        </label>
        {isUploadType ? (
          <div className="flex flex-col gap-3">
            {type === "linkedin" && (
              <p
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--color-text-secondary)", fontFamily: "'Courier New', monospace" }}
              >
                Open your LinkedIn profile → More → Save to PDF, then upload it here.
              </p>
            )}
            <input
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={handleFileChange}
              disabled={loading}
              className="w-full text-sm text-[var(--color-text-secondary)] file:mr-4 file:cursor-pointer file:border-0 file:bg-[var(--color-bg-surface)] file:px-4 file:py-3 file:text-sm file:font-bold file:uppercase file:tracking-[0.2em] file:text-[var(--color-text-primary)]"
              style={{
                borderBottom: "1px solid var(--color-border)",
                paddingBottom: "1rem",
                fontFamily: "'Courier New', monospace",
              }}
            />
            <textarea
              style={{
                backgroundColor: "var(--color-bg-primary)",
                borderColor: "var(--color-border)",
                borderBottomColor: "var(--color-border)",
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderTopWidth: 0,
                borderBottomWidth: "1px",
                color: "var(--color-text-primary)",
                fontFamily: "'Courier New', monospace",
                borderRadius: "0px",
              }}
              className="w-full min-h-44 px-0 py-5 text-sm leading-7 focus:outline-none focus:shadow-none transition-colors duration-200 resize-y"
              placeholder={type === "resume" ? "or paste resume text here" : "or paste profile text here"}
              value={pastedText}
              onChange={(e) => {
                setPastedText(e.target.value);
                setUploadError("");
                onUrlChange(e.target.value);
              }}
              onKeyDown={handleKey}
              disabled={loading}
              onFocus={(e) => {
                e.target.style.borderBottomColor = "var(--color-accent)";
              }}
              onBlur={(e) => {
                e.target.style.borderBottomColor = "var(--color-border)";
              }}
            />
            {uploadError ? (
              <p
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--color-accent)", fontFamily: "'Courier New', monospace" }}
              >
                {uploadError}
              </p>
            ) : uploadStatus ? (
              <p
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "var(--color-text-secondary)", fontFamily: "'Courier New', monospace" }}
              >
                {uploadStatus}
              </p>
            ) : null}
          </div>
        ) : (
          <input
            type="url"
            style={{
              backgroundColor: "var(--color-bg-primary)",
              borderColor: "var(--color-border)",
              borderBottomColor: "var(--color-border)",
              borderLeftWidth: 0,
              borderRightWidth: 0,
              borderTopWidth: 0,
              borderBottomWidth: "1px",
              color: "var(--color-text-primary)",
              fontFamily: "'Courier New', monospace",
              borderRadius: "0px",
            }}
            className="w-full px-0 py-5 text-sm focus:outline-none focus:shadow-none transition-colors duration-200"
            placeholder={type === "instagram" ? "https://instagram.com/username" : "https://github.com/username"}
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            onFocus={(e) => {
              e.target.style.borderBottomColor = "var(--color-accent)";
            }}
            onBlur={(e) => {
              e.target.style.borderBottomColor = "var(--color-border)";
            }}
          />
        )}
        <style>{`
          input::placeholder,
          textarea::placeholder {
            color: var(--color-text-secondary);
          }
        `}</style>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !url.trim()}
        style={{
          backgroundColor: loading || !url.trim() ? "var(--color-border)" : "var(--color-accent)",
          color: loading || !url.trim() ? "var(--color-text-secondary)" : "var(--color-bg-primary)",
          opacity: loading || !url.trim() ? 0.5 : 1,
          cursor: loading || !url.trim() ? "not-allowed" : "pointer",
          fontFamily: "'Courier New', monospace",
          borderRadius: "2px",
        }}
        className="w-full py-4 font-bold text-sm uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.99]"
        onMouseEnter={(e) => {
          if (!loading && url.trim()) {
            e.currentTarget.style.backgroundColor = "var(--color-accent-hover)";
            e.currentTarget.style.filter = "brightness(1.03)";
          }
        }}
        onMouseLeave={(e) => {
          if (!loading && url.trim()) {
            e.target.style.backgroundColor = "var(--color-accent)";
            e.currentTarget.style.filter = "brightness(1)";
          }
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-3">
            <span
              className="inline-block w-4 h-4 animate-spin"
              style={{
                borderWidth: "1px",
                borderColor: "var(--color-text-secondary)",
                borderTopColor: "var(--color-text-primary)",
                borderRadius: "2px",
              }}
            />
            roasting profile
          </span>
        ) : (
          "roast this profile"
        )}
      </button>

      <div className="flex flex-col gap-3">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Severity
        </label>
        <div className="grid grid-cols-3 gap-3">
          {severities.map((value) => {
            const selected = severity === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => onSeverityChange(value)}
                disabled={loading}
                style={{
                  backgroundColor: selected ? "var(--color-bg-hover)" : "var(--color-bg-surface)",
                  color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
                  borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                  borderWidth: "1px",
                  borderLeftWidth: "2px",
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                  borderRadius: "2px",
                  fontFamily: "'Courier New', monospace",
                }}
                className="flex min-h-12 items-center justify-center px-3 py-3 text-center text-xs uppercase tracking-[0.2em] transition-colors duration-200"
                onMouseEnter={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                    e.currentTarget.style.borderLeftColor = "var(--color-accent)";
                    e.currentTarget.style.color = "var(--color-accent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-surface)";
                    e.currentTarget.style.borderLeftColor = "var(--color-border)";
                    e.currentTarget.style.color = "var(--color-text-secondary)";
                  }
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Persona
        </label>
        <div className="grid grid-cols-1 gap-3">
          {PERSONAS.map(({ value, name, tagline }) => {
            const selected = persona === value;

            return (
              <button
                key={value}
                type="button"
                onClick={() => onPersonaChange(value)}
                disabled={loading}
                style={{
                  backgroundColor: selected ? "var(--color-bg-hover)" : "var(--color-bg-surface)",
                  borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                  borderWidth: "1px",
                  borderLeftWidth: "2px",
                  opacity: loading ? 0.5 : 1,
                  cursor: loading ? "not-allowed" : "pointer",
                  borderRadius: "2px",
                }}
                className="flex flex-col items-start gap-1 px-4 py-3 text-left transition-colors duration-200"
                onMouseEnter={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                    e.currentTarget.style.borderLeftColor = "var(--color-accent)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "var(--color-bg-surface)";
                    e.currentTarget.style.borderLeftColor = "var(--color-border)";
                  }
                }}
              >
                <span
                  className="text-sm font-bold uppercase tracking-[0.15em]"
                  style={{ color: selected ? "var(--color-accent)" : "var(--color-text-primary)", fontFamily: "'Courier New', monospace" }}
                >
                  {name}
                </span>
                <span
                  className="text-xs"
                  style={{ color: "var(--color-text-secondary)", fontFamily: "'Courier New', monospace" }}
                >
                  {tagline}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {import.meta.env.DEV && (
        <div className="flex flex-col gap-3">
          <label
            className="text-[10px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--color-text-secondary)" }}
          >
            Model (dev only)
          </label>
          <div className="grid grid-cols-2 gap-3">
            {models.map(({ value, label }) => {
              const selected = model === value;

              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => onModelChange(value)}
                  disabled={loading}
                  style={{
                    backgroundColor: selected ? "var(--color-bg-hover)" : "var(--color-bg-surface)",
                    color: selected ? "var(--color-accent)" : "var(--color-text-secondary)",
                    borderColor: selected ? "var(--color-accent)" : "var(--color-border)",
                    borderWidth: "1px",
                    borderLeftWidth: "2px",
                    opacity: loading ? 0.5 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                    borderRadius: "2px",
                    fontFamily: "'Courier New', monospace",
                  }}
                  className="flex min-h-12 items-center justify-center px-3 py-3 text-center text-xs uppercase tracking-[0.2em] transition-colors duration-200"
                  onMouseEnter={(e) => {
                    if (!loading && !selected) {
                      e.currentTarget.style.backgroundColor = "var(--color-bg-hover)";
                      e.currentTarget.style.borderLeftColor = "var(--color-accent)";
                      e.currentTarget.style.color = "var(--color-accent)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!loading && !selected) {
                      e.currentTarget.style.backgroundColor = "var(--color-bg-surface)";
                      e.currentTarget.style.borderLeftColor = "var(--color-border)";
                      e.currentTarget.style.color = "var(--color-text-secondary)";
                    }
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p
        className="text-center text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "var(--color-text-secondary)" }}
      >
        cmd + enter to submit
      </p>
    </div>
  );
}
