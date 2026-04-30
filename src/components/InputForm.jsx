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
        <label className="text-zinc-300 text-sm font-semibold">Profile Type</label>
        <div className="grid grid-cols-2 gap-2">
          {profileTypes.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onTypeChange(value)}
              disabled={loading}
              className={`py-3 px-4 rounded-lg font-medium transition-all duration-200 text-sm
                          ${
                            type === value
                              ? "bg-orange-500 text-white shadow-lg shadow-orange-500/50"
                              : "bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-orange-400/50"
                          }
                          disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-zinc-300 text-sm font-semibold">Profile URL</label>
        <input
          type="url"
          className="w-full rounded-lg border-2 border-orange-400/40 bg-zinc-900/80
                     p-4 text-zinc-100 placeholder-zinc-500 font-mono text-sm
                     focus:outline-none focus:border-orange-400
                     transition-colors duration-200 disabled:opacity-50"
          placeholder={`https://github.com/username${type === "linkedin" ? " or https://linkedin.com/in/name" : type === "instagram" ? " or https://instagram.com/username" : type === "twitter" ? " or https://twitter.com/username" : ""}`}
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKey}
          disabled={loading}
        />
      </div>

      <button
        onClick={onSubmit}
        disabled={loading || !url.trim()}
        className="w-full py-4 rounded-lg font-bold text-lg tracking-wide
                   bg-orange-500 hover:bg-orange-400 disabled:bg-zinc-700
                   disabled:text-zinc-500 text-white
                   transition-all duration-200 active:scale-95
                   disabled:cursor-not-allowed cursor-pointer"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Roasting profile…
          </span>
        ) : (
          "🔥 Roast This Profile"
        )}
      </button>
      <p className="text-center text-zinc-600 text-xs">⌘+Enter to submit</p>
    </div>
  );
}