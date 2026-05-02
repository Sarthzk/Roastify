import { useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

export default function InputForm({
  url,
  onUrlChange,
  type,
  onTypeChange,
  severity,
  onSeverityChange,
  onSubmit,
  loading,
}) {
  const [resumeText, setResumeText] = useState(url);
  const [resumeStatus, setResumeStatus] = useState("");

  const profileTypes = [
    { value: "github", label: "01 github" },
    { value: "linkedin", label: "02 linkedin" },
    { value: "instagram", label: "03 instagram" },
    { value: "resume", label: "04 resume" },
  ];

  const severities = ["mild", "medium", "destroy me"];

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

  async function handleResumeFileChange(event) {
    const file = event.target.files?.[0];
    setResumeStatus("");

    if (!file) {
      return;
    }

    const fileName = file.name;
    const isPdf = fileName.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
    const isText = fileName.toLowerCase().endsWith(".txt") || file.type.startsWith("text/");

    try {
      let extractedText = "";

      if (isPdf) {
        extractedText = await extractPdfText(file);
      } else if (isText) {
        extractedText = await file.text();
      } else {
        return;
      }

      const trimmedText = extractedText.trim();
      if (!trimmedText) {
        return;
      }

      setResumeText(trimmedText);
      onUrlChange(trimmedText);
      setResumeStatus(`extracted ${trimmedText.length} characters from ${fileName}`);
    } catch {
      // Silent fallback: the textarea below remains available for manual paste.
    }
  }

  return (
    <div className="w-full flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <label
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color: "#646669" }}
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
                  backgroundColor: selected ? "#1a1a1a" : "#0e0e0e",
                  color: selected ? "#e2b714" : "#646669",
                  borderColor: selected ? "#e2b714" : "#2c2e31",
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
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                    e.currentTarget.style.borderLeftColor = "#e2b714";
                    e.currentTarget.style.color = "#e2b714";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "#0e0e0e";
                    e.currentTarget.style.borderLeftColor = "#2c2e31";
                    e.currentTarget.style.color = "#646669";
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
          style={{ color: "#646669" }}
        >
          {type === "resume" ? "Resume Text" : "Profile URL"}
        </label>
        {type === "resume" ? (
          <div className="flex flex-col gap-3">
            <input
              type="file"
              accept=".pdf,.txt,application/pdf,text/plain"
              onChange={handleResumeFileChange}
              disabled={loading}
              className="w-full text-sm text-[#646669] file:mr-4 file:cursor-pointer file:border-0 file:bg-[#0e0e0e] file:px-4 file:py-3 file:text-sm file:font-bold file:uppercase file:tracking-[0.2em] file:text-[#d1d0c5]"
              style={{
                borderBottom: "1px solid #2c2e31",
                paddingBottom: "1rem",
                fontFamily: "'Courier New', monospace",
              }}
            />
            <textarea
              style={{
                backgroundColor: "#000000",
                borderColor: "#2c2e31",
                borderBottomColor: "#2c2e31",
                borderLeftWidth: 0,
                borderRightWidth: 0,
                borderTopWidth: 0,
                borderBottomWidth: "1px",
                color: "#d1d0c5",
                fontFamily: "'Courier New', monospace",
                borderRadius: "0px",
              }}
              className="w-full min-h-44 px-0 py-5 text-sm leading-7 focus:outline-none focus:shadow-none transition-colors duration-200 resize-y"
              placeholder="or paste resume text here"
              value={resumeText}
              onChange={(e) => {
                setResumeText(e.target.value);
                onUrlChange(e.target.value);
              }}
              onKeyDown={handleKey}
              disabled={loading}
              onFocus={(e) => {
                e.target.style.borderBottomColor = "#e2b714";
              }}
              onBlur={(e) => {
                e.target.style.borderBottomColor = "#2c2e31";
              }}
            />
            {resumeStatus ? (
              <p
                className="text-[10px] uppercase tracking-[0.18em]"
                style={{ color: "#646669", fontFamily: "'Courier New', monospace" }}
              >
                {resumeStatus}
              </p>
            ) : null}
          </div>
        ) : (
          <input
            type="url"
            style={{
              backgroundColor: "#000000",
              borderColor: "#2c2e31",
              borderBottomColor: "#2c2e31",
              borderLeftWidth: 0,
              borderRightWidth: 0,
              borderTopWidth: 0,
              borderBottomWidth: "1px",
              color: "#d1d0c5",
              fontFamily: "'Courier New', monospace",
              borderRadius: "0px",
            }}
            className="w-full px-0 py-5 text-sm focus:outline-none focus:shadow-none transition-colors duration-200"
            placeholder={
              type === "github"
                ? "https://github.com/username"
                : type === "linkedin"
                ? "https://linkedin.com/in/name"
                : type === "instagram"
                ? "https://instagram.com/username"
                : "https://github.com/username"
            }
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
            onFocus={(e) => {
              e.target.style.borderBottomColor = "#e2b714";
            }}
            onBlur={(e) => {
              e.target.style.borderBottomColor = "#2c2e31";
            }}
          />
        )}
        <style>{`
          input::placeholder,
          textarea::placeholder {
            color: #646669;
          }
        `}</style>
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !url.trim()}
        style={{
          backgroundColor: loading || !url.trim() ? "#2c2e31" : "#e2b714",
          color: loading || !url.trim() ? "#646669" : "#000000",
          opacity: loading || !url.trim() ? 0.5 : 1,
          cursor: loading || !url.trim() ? "not-allowed" : "pointer",
          fontFamily: "'Courier New', monospace",
          borderRadius: "2px",
        }}
        className="w-full py-4 font-bold text-sm uppercase tracking-[0.15em] transition-all duration-200 active:scale-[0.99]"
        onMouseEnter={(e) => {
          if (!loading && url.trim()) {
            e.currentTarget.style.backgroundColor = "#f0c832";
            e.currentTarget.style.filter = "brightness(1.03)";
          }
        }}
        onMouseLeave={(e) => {
          if (!loading && url.trim()) {
            e.target.style.backgroundColor = "#e2b714";
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
                borderColor: "#646669",
                borderTopColor: "#d1d0c5",
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
          style={{ color: "#646669" }}
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
                  backgroundColor: selected ? "#1a1a1a" : "#0e0e0e",
                  color: selected ? "#e2b714" : "#646669",
                  borderColor: selected ? "#e2b714" : "#2c2e31",
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
                    e.currentTarget.style.backgroundColor = "#1a1a1a";
                    e.currentTarget.style.borderLeftColor = "#e2b714";
                    e.currentTarget.style.color = "#e2b714";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!loading && !selected) {
                    e.currentTarget.style.backgroundColor = "#0e0e0e";
                    e.currentTarget.style.borderLeftColor = "#2c2e31";
                    e.currentTarget.style.color = "#646669";
                  }
                }}
              >
                {value}
              </button>
            );
          })}
        </div>
      </div>

      <p
        className="text-center text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "#646669" }}
      >
        cmd + enter to submit
      </p>
    </div>
  );
}
