import { useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PERSONAS } from "../lib/personas";
import { GithubIcon, LinkedinIcon, InstagramIcon, ResumeIcon } from "./PlatformIcons";
import {
  sourceState,
  classifyUploadFile,
  unsupportedFileMessage,
  emptyExtractionMessage,
  extractionFailedMessage,
} from "../lib/inputFormHelpers";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// Order matches the Stitch mockup's 4-up grid exactly (github/linkedin/resume/
// instagram) — unlike the previous dark redesign, which moved instagram (the only
// source that can be locked/disabled) to the end. `demoValue` backs the "Load Demo"
// button below.
const PROFILE_TYPES = [
  { value: "github", name: "GitHub", icon: <GithubIcon />, kind: "link", label: "Target url or username", placeholder: "e.g. github.com/username", demoValue: "github.com/sarthzk" },
  {
    value: "linkedin",
    name: "LinkedIn",
    icon: <LinkedinIcon />,
    kind: "pdf",
    label: "Profile pdf",
    hint: "Open your LinkedIn profile → More → Save to PDF.",
    dropLabel: "drop your linkedin pdf",
    pastePlaceholder: "…or paste the text of your profile here.",
    demoValue: "Senior Growth Strategist & Synergy Architect. Passionate about leveraging cross-functional paradigm shifts to disrupt legacy thinking. 500+ connections.",
  },
  {
    value: "resume",
    name: "Resume",
    icon: <ResumeIcon />,
    kind: "pdf",
    label: "Resume pdf",
    hint: "PDF works best. Plain text is fine too.",
    dropLabel: "drop your resume pdf",
    pastePlaceholder: "…or paste your resume text here.",
    demoValue: "OBJECTIVE: Dynamic self-starter seeking to leverage synergies. EXPERIENCE: Intern, did some stuff with spreadsheets. SKILLS: Microsoft Word, Team Player, Fast Learner.",
  },
  { value: "instagram", name: "Insta", icon: <InstagramIcon />, kind: "link", label: "Target url or username", placeholder: "e.g. instagram.com/username", demoValue: "instagram.com/alex_codes_lifestyle", gated: true },
];

const SEVERITIES = [
  { value: "mild", label: "Mild", hintClass: "" },
  { value: "medium", label: "Medium", hintClass: "" },
  { value: "destroy me", label: "Destroy Me", hintClass: "rs-field-hint--nuclear" },
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
  disabled,
  instagramEnabled,
  signedIn,
  onSignIn,
}) {
  const [fileInfo, setFileInfo] = useState(null);
  const [uploadStatus, setUploadStatus] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Which inline prompt is showing beneath the platform grid — null, "locked" (needs
  // sign-in), or "disabled" (kill switch off). Set by clicking a non-open source cell
  // instead of selecting it.
  const [prompt, setPrompt] = useState(null);
  const fileInputRef = useRef(null);

  const active = PROFILE_TYPES.find((t) => t.value === type) || PROFILE_TYPES[0];
  const isUploadType = active.kind === "pdf";
  const activeSeverity = SEVERITIES.find((s) => s.value === severity) || SEVERITIES[1];

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

  // No equivalent field exists to "demo" for an upload type beyond prefilling the paste
  // textarea with sample text — there's no sample file to attach. Link types fill the
  // URL field, matching the mockup's own "Load Demo" behavior exactly.
  function handleLoadDemo() {
    onUrlChange(active.demoValue);
    if (isUploadType) {
      setFileInfo(null);
      setUploadStatus("");
      setUploadError("");
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
    const { isPdf, isSupported } = classifyUploadFile(fileName, file.type);

    if (!isSupported) {
      setUploadError(unsupportedFileMessage(fileName));
      return;
    }

    try {
      const extractedText = isPdf ? await extractPdfText(file) : await file.text();
      const trimmedText = extractedText.trim();

      if (!trimmedText) {
        setUploadError(emptyExtractionMessage(fileName));
        return;
      }

      onUrlChange(trimmedText);
      setFileInfo({ name: fileName });
      setUploadStatus(`extracted text from ${fileName}`);
    } catch {
      setUploadError(extractionFailedMessage(fileName));
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
    <div className="rs-card">
      {/* 01. Target platform */}
      <div>
        <div className="rs-field-head">
          <span className="rs-field-label">01. Target platform</span>
          <span className="rs-field-hint">Select source</span>
        </div>
        <div className="rs-platform-grid">
          {PROFILE_TYPES.map((t) => {
            const state = sourceState(t, { instagramEnabled, signedIn });
            const selected = type === t.value && state === "open";
            let tagText = null;
            if (state === "locked") tagText = "sign in";
            if (state === "disabled") tagText = "off";
            return (
              <button
                key={t.value}
                type="button"
                className={`rs-platform-btn${selected ? " is-selected" : ""}${state === "locked" ? " is-locked" : ""}${state === "disabled" ? " is-disabled" : ""}`}
                disabled={loading}
                onClick={() => handleSourceClick(t)}
              >
                <span className="rs-platform-icon">{t.icon}</span>
                <span>{t.name}</span>
                {tagText && <span className="rs-platform-tag">{tagText}</span>}
              </button>
            );
          })}
        </div>

        {prompt && (
          <div className="rs-source-prompt" style={{ marginTop: "10px" }}>
            <span className="rs-source-prompt-text">
              {promptIsLock
                ? "Instagram needs an account — it's the only source that costs us to run. Sign in and your daily limit goes to 15 as well."
                : "Instagram is temporarily unavailable. The other three sources are unaffected."}
            </span>
            {promptIsLock && (
              <div className="rs-source-prompt-actions">
                <button type="button" className="rs-source-prompt-btn" onClick={() => onSignIn("github")}>
                  github
                </button>
                <button type="button" className="rs-source-prompt-btn" onClick={() => onSignIn("google")}>
                  google
                </button>
              </div>
            )}
            <button type="button" className="rs-source-prompt-close" onClick={() => setPrompt(null)}>
              close
            </button>
          </div>
        )}
      </div>

      {/* 02. Target input */}
      <div>
        <div className="rs-field-head">
          <span className="rs-field-label">02. {active.label}</span>
          <button type="button" className="rs-demo-btn" onClick={handleLoadDemo} disabled={loading}>
            Load demo
          </button>
        </div>

        {!isUploadType && (
          <input
            type="text"
            className="rs-input"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            onKeyDown={handleKey}
            placeholder={active.placeholder}
            disabled={loading}
          />
        )}

        {isUploadType && (
          <div>
            <p className="rs-upload-hint">{active.hint}</p>

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
                className={`rs-dropzone${dragging ? " is-dragging" : ""}`}
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
                <span className="rs-dropzone-arrow">↓</span>
                <span className="rs-dropzone-label">{dragging ? "release to read it" : active.dropLabel}</span>
                <span className="rs-dropzone-browse">click to browse</span>
              </div>
            )}

            {fileInfo && (
              <div className="rs-file-row">
                <span className="rs-file-check">✓</span>
                <span className="rs-file-name">{fileInfo.name}</span>
                <button
                  type="button"
                  className="rs-file-replace"
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

            <div className="rs-paste-divider">
              <span className="rs-paste-divider-label">or paste the text</span>
              <span className="rs-paste-divider-rule" />
            </div>
            <textarea
              className="rs-paste-area"
              value={url}
              onChange={(e) => onUrlChange(e.target.value)}
              onKeyDown={handleKey}
              placeholder={active.pastePlaceholder}
              disabled={loading}
            />

            {uploadError ? (
              <p className="rs-upload-error">{uploadError}</p>
            ) : uploadStatus ? (
              <p className="rs-upload-status">{uploadStatus}</p>
            ) : null}
          </div>
        )}
      </div>

      {/* 03. Roast intensity */}
      <div>
        <div className="rs-field-head">
          <span className="rs-field-label">03. Roast intensity</span>
          <span className={`rs-field-hint ${activeSeverity.hintClass}`}>{activeSeverity.label}</span>
        </div>
        <div className="rs-severity-grid">
          {SEVERITIES.map((sv) => {
            const selected = severity === sv.value;
            const modifier = sv.value === "destroy me" ? "destroy-me" : sv.value;
            return (
              <button
                key={sv.value}
                type="button"
                className={`rs-severity-btn rs-severity-btn--${modifier}${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onSeverityChange(sv.value)}
              >
                {sv.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 04. Persona */}
      <div>
        <div className="rs-field-head">
          <span className="rs-field-label">04. Choose executioner persona</span>
        </div>
        <div className="rs-persona-list">
          {PERSONAS.map((p) => {
            const selected = persona === p.value;
            return (
              <button
                key={p.value}
                type="button"
                className={`rs-persona-card${selected ? " is-selected" : ""}`}
                disabled={loading}
                onClick={() => onPersonaChange(p.value)}
              >
                <span className="rs-persona-main">
                  <span className="rs-persona-icon">{p.icon}</span>
                  <span className="rs-persona-body">
                    <span className="rs-persona-name">{p.name}</span>
                    <p className="rs-persona-note">{p.tagline}</p>
                  </span>
                </span>
                <span className="rs-persona-radio">{selected && <span className="rs-persona-radio-dot" />}</span>
              </button>
            );
          })}
        </div>
      </div>

      {import.meta.env.DEV && (
        <div>
          <div className="rs-field-head">
            <span className="rs-field-label">Model (dev)</span>
          </div>
          <div className="rs-model-grid">
            {MODELS.map((m) => {
              const selected = model === m.value;
              return (
                <button
                  key={m.value}
                  type="button"
                  className={`rs-platform-btn${selected ? " is-selected" : ""}`}
                  disabled={loading}
                  onClick={() => onModelChange(m.value)}
                  style={{ minHeight: "48px" }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Primary action — inside the same bordered card as the four steps above, matching
          the mockup's single-card anatomy (one hard shadow, not two stacked boxes). No
          rate-limit/"saved" line here — the header's quota badge (Layout.jsx) is the one
          place that shows today's count now, so this doesn't say it twice. */}
      <div>
        <button type="button" className={`rs-submit${loading ? " is-streaming" : ""}`} disabled={disabled} onClick={onSubmit}>
          <span>{loading ? "synthesizing brutality…" : "execute roast"}</span>
          <span>&#128293;</span>
        </button>
        {loading && (
          <div className="rs-progress-track">
            <div className="rs-progress-bar" />
          </div>
        )}
      </div>
    </div>
  );
}
