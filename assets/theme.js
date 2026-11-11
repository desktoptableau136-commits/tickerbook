// Apply the saved theme before first paint (kept in a file so the CSP can forbid inline scripts).
try { const t = localStorage.getItem("stockdash.theme"); if (t === "light" || t === "dark") document.documentElement.dataset.theme = t; } catch {}
