/**
 * Escapes text for safe interpolation into HTML.
 *
 * @param value - Untrusted text
 * @returns Escaped text
 */
export function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const STYLES = `
:root { color-scheme: light dark; --bg:#f6f7f9; --fg:#1b1f24; --muted:#6a737d; --card:#fff; --line:#e3e6ea; --accent:#3b6ef5; --bad:#d64545; }
@media (prefers-color-scheme: dark) { :root { --bg:#111418; --fg:#e8eaed; --muted:#9aa3ad; --card:#1a1e24; --line:#2a3038; --accent:#7a9bff; --bad:#ff7b7b; } }
* { box-sizing: border-box; }
body { margin:0; font:15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; background:var(--bg); color:var(--fg); }
header { display:flex; gap:1.5rem; align-items:center; padding:1rem 1.5rem; border-bottom:1px solid var(--line); background:var(--card); }
a { color:var(--accent); }
header a { color:var(--fg); text-decoration:none; } header .brand { font-weight:700; font-size:1.15rem; }
header nav { display:flex; gap:1rem; } header nav a { color:var(--muted); } header nav a:hover { color:var(--fg); }
main { max-width:1100px; margin:0 auto; padding:1.5rem; }
h1 { font-size:1.4rem; margin:0 0 1rem; }
.muted { color:var(--muted); }
.panel { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem 1.25rem; margin-bottom:1.5rem; }
.drop { border:2px dashed var(--line); border-radius:10px; padding:1.5rem; text-align:center; cursor:pointer; }
.drop.over { border-color:var(--accent); }
.grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:1rem; }
.card { background:var(--card); border:1px solid var(--line); border-radius:10px; overflow:hidden; color:inherit; text-decoration:none; display:block; }
.card .thumb { aspect-ratio:4/3; display:flex; align-items:center; justify-content:center; background:var(--line); }
.card .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
.card .meta { padding:.5rem .75rem; font-size:.85rem; }
.card .name { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
.badge { display:inline-block; padding:.05rem .5rem; border-radius:99px; font-size:.75rem; border:1px solid var(--line); }
.badge.ready { color:#1a7f37; border-color:#1a7f37; } .badge.failed { color:var(--bad); border-color:var(--bad); }
.badge.processing, .badge.queued { color:var(--accent); border-color:var(--accent); }
.spinner { width:28px; height:28px; border:3px solid var(--muted); border-top-color:transparent; border-radius:50%; animation:spin 1s linear infinite; }
@keyframes spin { to { transform:rotate(360deg); } }
table { border-collapse:collapse; width:100%; } th, td { text-align:left; padding:.5rem; border-bottom:1px solid var(--line); }
.swatch { display:inline-block; width:1rem; height:1rem; border-radius:4px; vertical-align:middle; border:1px solid var(--line); }
.variant img { max-width:100%; height:auto; display:block; border-radius:6px; margin:.5rem 0; }
.stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:1rem; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:1rem; } .stat b { display:block; font-size:2rem; }
.error { color:var(--bad); }
button { font:inherit; padding:.4rem .9rem; border-radius:6px; border:1px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
`;

/**
 * Wraps page content in the shared layout.
 *
 * @param title - Page title
 * @param body - Trusted HTML for `<main>`
 * @param script - Optional inline script (trusted)
 * @returns A complete HTML document
 */
export function layout(title: string, body: string, script = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · thumbs</title>
<style>${STYLES}</style>
</head>
<body>
<header><a class="brand" href="/">thumbs</a><nav><a href="/">Gallery</a><a href="/status">Queue status</a></nav></header>
<main>${body}</main>
${script ? `<script>${script}</script>` : ''}
</body>
</html>`;
}
