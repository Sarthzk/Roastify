export default function InputForm({ url, onUrlChange, type, onTypeChange, onSubmit, loading }) {
  const profileTypes = [
    { value: "github", label: "01 github" },
    { value: "linkedin", label: "02 linkedin" },
    { value: "instagram", label: "03 instagram" },
    { value: "twitter", label: "04 twitter" },
  ];

  function handleKey(e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit();
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
          Profile URL
        </label>
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
          placeholder={`https://github.com/username${type === "linkedin" ? " or https://linkedin.com/in/name" : type === "instagram" ? " or https://instagram.com/username" : type === "twitter" ? " or https://twitter.com/username" : ""}`}
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
      <p
        className="text-center text-[10px] uppercase tracking-[0.18em]"
        style={{ color: "#646669" }}
      >
        cmd + enter to submit
      </p>
    </div>
  );
}
