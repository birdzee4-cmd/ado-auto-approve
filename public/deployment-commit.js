import { escapeHtml } from './core.js';

export function renderCommit(item, full = false) {
  const commit = String(item.sourceVersion || '');
  if (!/^[a-f0-9]{40}$/i.test(commit)) return '<span class="muted">Commit: ยังไม่มีข้อมูล</span>';
  const label = full ? commit : commit.slice(0, 8);
  let href = '';
  try {
    const runUrl = new URL(item.url);
    const parts = runUrl.pathname.split('/').filter(Boolean);
    const repo = item.repositoryId || item.repositoryName;
    if (runUrl.protocol === 'https:' && runUrl.hostname === 'dev.azure.com' && parts.length >= 2 && repo) {
      href = `https://dev.azure.com/${parts[0]}/${parts[1]}/_git/${encodeURIComponent(repo)}/commit/${commit}`;
    }
  } catch {}
  return `Commit: ${href ? `<a href="${escapeHtml(href)}" title="${escapeHtml(commit)}" target="_blank" rel="noreferrer"><code>${escapeHtml(label)}</code></a>` : `<code title="${escapeHtml(commit)}">${escapeHtml(label)}</code>`}`;
}
