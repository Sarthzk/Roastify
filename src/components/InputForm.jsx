export default function InputForm({ url, onUrlChange, type, onTypeChange, onSubmit, loading }) {
  const profileTypes = [
    { value: "github", label: "🐙 GitHub" },
    { value: "linkedin", label: "💼 LinkedIn" },
    { value: "instagram", label: "📸 Instagram" },
    { value: "twitter", label: "𝕏 Twitter" },
  ];

  function handleKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
  }

  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold" style={{ color: "#d1d0c5" }}>
          Profile Type
        </label>
        <div className="grid grid-cols-2 gap-2">
          {profileTypes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onTypeChange(value)}
              disabled={loading}
              style={{
                backgroundColor: type === value ? "#e2b714" : "#111111",
                color: type === value ? "#000000" : "#d1d0c5",
                borderColor: type === value ? "#e2b714" : "#2c2e31",
                borderWidth: "2px",
                opacity: loading ? 0.5 : 1,
                cursor: loading ? "not-allowed" : "pointer",
              }}
              className="py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm"
              onMouseEnter={(e) => {
                if (type !== value && !loading) {
                  e.target.style.borderColor = "#646669";
                  e.target.style.backgroundColor = "#0d0d0d";
                }
              }}
              onMouseLeave={(e) => {
                if (type !== value && !loading) {
                  e.target.style.borderColor = "#2c2e31";
                  e.target.style.backgroundColor = "#111111";
                }
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm font-semibold" style={{ color: "#d1d0c5" }}>
          Profile URL
        </label>
        <input
          type="url"
          style={{
            backgroundColor: "#111111",
            borderColor: "#2c2e31",
            color: "#d1d0c5",
            fontFamily: "'Courier New', monospace",
          }}
          className="w-full rounded-lg border-2 p-4 text-sm focus:outline-none transition-colors duration-200"
          placeholder={`https://github.com/username${type === "linkedin" ? " or https://linkedin.com/in/name" : type === "instagram" ? " or https://instagram.com/username" : type === "twitter" ? " or https://twitter.com/username" : ""}`}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
          onFocus={(e) => {
            e.target.style.borderColor = "#646669";
          }}
          onBlur={(e) => {
            e.target.style.borderColor = "#2c2e31";
          }}
        />
        <style>{`
          input::placeholder {
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
        }}
        className="w-full py-4 rounded-lg font-bold text-lg tracking-wide transition-all duration-200 active:scale-95"
        onMouseEnter={(e) => {
          if (!loading && url.trim()) {
            e.target.style.backgroundColor = "#f0d66f";
          }
        }}
        onMouseLeave={(e) => {
          if (!loading && url.trim()) {
            e.target.style.backgroundColor = "#e2b714";
          }
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span
              className="inline-block w-4 h-4 rounded-full animate-spin"
              style={{
                borderWidth: "2px",
                borderColor: "#646669",
                borderTopColor: "#d1d0c5",
              }}
            />
            Roasting profile…
          </span>
        ) : (
          "🔥 Roast This Profile"
        )}
      </button>
      <p className="text-center text-xs" style={{ color: "#646669" }}>
        ⌘+Enter to submit
      </p>
    </div>
  );
}
