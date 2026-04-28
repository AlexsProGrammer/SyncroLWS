/**
 * Phase M — token-gated client portal.
 *
 * Reads `?token=<JWT>` from the URL, calls the scoped backend API, and
 * renders a read-only (or limited-write) view of the shared workspace. Zero
 * CDN calls — all styling is inline. Markdown is rendered via a tiny safe
 * converter that only emits paragraphs/links/code blocks/headings/lists.
 */
import { useEffect, useMemo, useState } from 'react';

interface ShareInfo {
  id: string;
  label: string;
  profile_id: string;
  workspace_id: string;
  parent_entity_id: string | null;
  can_upload: boolean;
  can_submit: boolean;
  expires_at: string | null;
}

interface CoreRow {
  id: string;
  title: string;
  description: string;
  color: string;
  icon: string;
  tags: string[];
  parent_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AspectRow {
  id: string;
  entity_id: string;
  aspect_type: string;
  data: Record<string, unknown>;
}

interface RelationRow {
  id: string;
  from_entity_id: string;
  to_entity_id: string;
  kind: string;
}

interface PortalData {
  cores: CoreRow[];
  aspects: AspectRow[];
  relations: RelationRow[];
}

type View = 'overview' | 'notes' | 'tasks' | 'calendar' | 'files' | 'submit';

function extractToken(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('token');
  if (fromQuery) return fromQuery;
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (last && last.length > 30) return last;
  return null;
}

const API_BASE = '/portal-api';

async function api<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMarkdown(md: string): string {
  if (!md) return '';
  const lines = md.split('\n');
  const out: string[] = [];
  let inList = false;
  let inCode = false;
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length === 0) return;
    let text = escapeHtml(para.join(' '));
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );
    out.push(`<p>${text}</p>`);
    para = [];
  };
  const closeList = (): void => {
    if (inList) { out.push('</ul>'); inList = false; }
  };
  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      flushPara(); closeList();
      if (inCode) { out.push('</code></pre>'); inCode = false; }
      else { out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }
    const headingMatch = /^(#{1,3})\s+(.*)$/.exec(raw);
    if (headingMatch) {
      flushPara(); closeList();
      const level = headingMatch[1]!.length;
      out.push(`<h${level}>${escapeHtml(headingMatch[2]!)}</h${level}>`);
      continue;
    }
    const bulletMatch = /^[-*]\s+(.*)$/.exec(raw);
    if (bulletMatch) {
      flushPara();
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${escapeHtml(bulletMatch[1]!)}</li>`);
      continue;
    }
    if (raw.trim() === '') { flushPara(); closeList(); continue; }
    closeList();
    para.push(raw);
  }
  flushPara();
  closeList();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

export function Portal(): JSX.Element {
  const token = useMemo(() => extractToken(), []);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('overview');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token) {
      setError('Missing share token. Open the URL provided to you with the `?token=…` query intact.');
      return;
    }
    void (async (): Promise<void> => {
      try {
        const me = await api<ShareInfo>('/me', token);
        setShare(me);
        const d = await api<PortalData>('/data', token);
        setData(d);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [token, reloadKey]);

  if (error) return <ErrorScreen message={error} />;
  if (!share || !data) return <Loading />;

  return (
    <div style={S.shell}>
      <Header share={share} />
      <Nav view={view} setView={setView} share={share} />
      <main style={S.main}>
        {view === 'overview' && <Overview data={data} />}
        {view === 'notes' && <NotesList data={data} />}
        {view === 'tasks' && <TaskBoard data={data} />}
        {view === 'calendar' && <CalendarList data={data} />}
        {view === 'files' && (
          <FilesList
            data={data}
            share={share}
            token={token!}
            onReload={() => setReloadKey((k) => k + 1)}
          />
        )}
        {view === 'submit' && share.can_submit && (
          <SubmitForm token={token!} onSubmitted={() => setReloadKey((k) => k + 1)} />
        )}
      </main>
      <footer style={S.footer}>
        <span>SyncroLWS portal · GDPR-friendly · zero CDN</span>
        {share.expires_at && (
          <span>Expires {new Date(share.expires_at).toLocaleString()}</span>
        )}
      </footer>
    </div>
  );
}

function Header({ share }: { share: ShareInfo }): JSX.Element {
  return (
    <header style={S.header}>
      <div>
        <h1 style={S.title}>{share.label || 'Shared workspace'}</h1>
        <p style={S.lead}>
          Read-only view shared with you.{' '}
          {share.can_upload && <strong>Uploads enabled. </strong>}
          {share.can_submit && <strong>Submissions enabled. </strong>}
        </p>
      </div>
    </header>
  );
}

function Nav({
  view, setView, share,
}: { view: View; setView: (v: View) => void; share: ShareInfo }): JSX.Element {
  const tabs: { id: View; label: string; visible: boolean }[] = [
    { id: 'overview', label: 'Overview', visible: true },
    { id: 'notes', label: 'Notes', visible: true },
    { id: 'tasks', label: 'Tasks', visible: true },
    { id: 'calendar', label: 'Calendar', visible: true },
    { id: 'files', label: 'Files', visible: true },
    { id: 'submit', label: 'Submit', visible: share.can_submit },
  ];
  return (
    <nav style={S.nav}>
      {tabs.filter((t) => t.visible).map((t) => (
        <button
          key={t.id}
          onClick={() => setView(t.id)}
          style={{ ...S.tab, ...(view === t.id ? S.tabActive : {}) }}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}

function Loading(): JSX.Element {
  return <div style={S.center}><p style={S.lead}>Loading…</p></div>;
}

function ErrorScreen({ message }: { message: string }): JSX.Element {
  return (
    <div style={S.center}>
      <h1 style={S.title}>Cannot open share link</h1>
      <p style={S.lead}>{message}</p>
    </div>
  );
}

function Overview({ data }: { data: PortalData }): JSX.Element {
  const counts: Record<string, number> = {};
  for (const a of data.aspects) {
    counts[a.aspect_type] = (counts[a.aspect_type] ?? 0) + 1;
  }
  return (
    <section>
      <h2 style={S.h2}>Overview</h2>
      <p style={S.lead}>
        {data.cores.length} entities · {data.aspects.length} aspects · {data.relations.length} relations.
      </p>
      <ul style={S.dl}>
        {Object.entries(counts).map(([k, v]) => (
          <li key={k} style={S.dlRow}><span>{k}</span><strong>{v}</strong></li>
        ))}
      </ul>
    </section>
  );
}

function NotesList({ data }: { data: PortalData }): JSX.Element {
  const noteAspects = data.aspects.filter((a) => a.aspect_type === 'note');
  if (noteAspects.length === 0) return <Empty label="No notes shared." />;
  const coreById = new Map(data.cores.map((c) => [c.id, c]));
  return (
    <section>
      <h2 style={S.h2}>Notes</h2>
      {noteAspects.map((a) => {
        const core = coreById.get(a.entity_id);
        const md = typeof a.data['content_md'] === 'string' ? (a.data['content_md'] as string) : '';
        return (
          <article key={a.id} style={S.card}>
            <h3 style={S.h3}>{core?.title || 'Untitled'}</h3>
            <div style={S.proseBox} dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
          </article>
        );
      })}
    </section>
  );
}

function TaskBoard({ data }: { data: PortalData }): JSX.Element {
  const taskAspects = data.aspects.filter((a) => a.aspect_type === 'task');
  if (taskAspects.length === 0) return <Empty label="No tasks shared." />;
  const coreById = new Map(data.cores.map((c) => [c.id, c]));
  const cols: Record<string, AspectRow[]> = { todo: [], in_progress: [], done: [] };
  for (const a of taskAspects) {
    const status = (a.data['status'] as string) || 'todo';
    (cols[status] ?? (cols[status] = [])).push(a);
  }
  return (
    <section>
      <h2 style={S.h2}>Tasks</h2>
      <div style={S.kanban}>
        {Object.entries(cols).map(([status, rows]) => (
          <div key={status} style={S.col}>
            <div style={S.colHead}>{status} · {rows.length}</div>
            {rows.map((a) => {
              const core = coreById.get(a.entity_id);
              return (
                <div key={a.id} style={S.taskCard}>
                  <div style={{ fontWeight: 600 }}>{core?.title || 'Untitled'}</div>
                  {core?.description && <div style={S.muted}>{core.description}</div>}
                  {typeof a.data['due_date'] === 'string' && (
                    <div style={S.tagPill}>Due {a.data['due_date']}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function CalendarList({ data }: { data: PortalData }): JSX.Element {
  const calAspects = data.aspects.filter((a) => a.aspect_type === 'calendar_event');
  if (calAspects.length === 0) return <Empty label="No events shared." />;
  const coreById = new Map(data.cores.map((c) => [c.id, c]));
  const sorted = calAspects.slice().sort((a, b) => {
    const aStart = (a.data['start_at'] as string) || '';
    const bStart = (b.data['start_at'] as string) || '';
    return aStart.localeCompare(bStart);
  });
  return (
    <section>
      <h2 style={S.h2}>Calendar</h2>
      <ul style={S.list}>
        {sorted.map((a) => {
          const core = coreById.get(a.entity_id);
          const start = (a.data['start_at'] as string) ?? '';
          const end = (a.data['end_at'] as string) ?? '';
          return (
            <li key={a.id} style={S.row}>
              <div style={S.rowDate}>{start.slice(0, 16).replace('T', ' ')}</div>
              <div>
                <div style={{ fontWeight: 600 }}>{core?.title || 'Untitled'}</div>
                {end && <div style={S.muted}>until {end.slice(0, 16).replace('T', ' ')}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FilesList({
  data, share, token, onReload,
}: { data: PortalData; share: ShareInfo; token: string; onReload: () => void }): JSX.Element {
  const fileAspects = data.aspects.filter((a) => a.aspect_type === 'file_attachment');
  return (
    <section>
      <h2 style={S.h2}>Files</h2>
      {fileAspects.length === 0 ? (
        <Empty label="No files shared." />
      ) : (
        <ul style={S.list}>
          {fileAspects.map((a) => {
            const hash = a.data['hash'] as string | undefined;
            const name = (a.data['name'] as string) || 'file';
            const size = a.data['size_bytes'] as number | undefined;
            return (
              <li key={a.id} style={S.row}>
                <div>
                  <div style={{ fontWeight: 600 }}>{name}</div>
                  {size !== undefined && <div style={S.muted}>{(size / 1024).toFixed(1)} KB</div>}
                </div>
                {hash && (
                  <a href={`${API_BASE}/file/${hash}?token=${encodeURIComponent(token)}`} style={S.btn}>
                    Download
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {share.can_upload && <UploadForm token={token} onUploaded={onReload} />}
    </section>
  );
}

function UploadForm({ token, onUploaded }: { token: string; onUploaded: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget;
    const file = (form.elements.namedItem('file') as HTMLInputElement | null)?.files?.[0];
    if (!file) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api<{ hash: string; original_name?: string }>('/upload', token, {
        method: 'POST', body: fd,
      });
      setMsg(`Uploaded ${result.original_name ?? file.name}.`);
      form.reset();
      onUploaded();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={onSubmit} style={S.form}>
      <label style={S.label}>Upload a file</label>
      <input name="file" type="file" required style={S.input} />
      <button type="submit" disabled={busy} style={S.btnPrimary}>{busy ? 'Uploading…' : 'Upload'}</button>
      {msg && <p style={S.muted}>{msg}</p>}
    </form>
  );
}

function SubmitForm({ token, onSubmitted }: { token: string; onSubmitted: () => void }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const onSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    setBusy(true); setMsg(null);
    try {
      const res = await api<{ id: string }>('/submit', token, {
        method: 'POST',
        body: JSON.stringify({ title: data.get('title'), body: data.get('body') }),
      });
      setMsg(`Submitted (${res.id.slice(0, 8)}). The owner will see this in their next sync.`);
      form.reset();
      onSubmitted();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h2 style={S.h2}>Submit a note</h2>
      <p style={S.lead}>Anything you submit here is delivered as a note to the project owner.</p>
      <form onSubmit={onSubmit} style={S.form}>
        <label style={S.label}>Title</label>
        <input name="title" required maxLength={200} style={S.input} />
        <label style={S.label}>Message</label>
        <textarea name="body" rows={8} maxLength={50000} style={S.textarea} />
        <button type="submit" disabled={busy} style={S.btnPrimary}>{busy ? 'Submitting…' : 'Submit'}</button>
        {msg && <p style={S.muted}>{msg}</p>}
      </form>
    </section>
  );
}

function Empty({ label }: { label: string }): JSX.Element {
  return <p style={S.muted}>{label}</p>;
}

const S: Record<string, React.CSSProperties> = {
  shell: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' },
  header: { padding: '32px 32px 16px', borderBottom: '1px solid #e2e8f0', background: '#fff' },
  title: { fontSize: 24, fontWeight: 700, margin: 0 },
  lead: { color: '#475569', margin: '6px 0 0', fontSize: 14, lineHeight: 1.55 },
  nav: { display: 'flex', gap: 4, padding: '8px 24px', background: '#fff', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 14px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, color: '#475569', borderRadius: 6 },
  tabActive: { background: '#eef2ff', color: '#312e81', fontWeight: 600 },
  main: { flex: 1, padding: '24px 32px', maxWidth: 980, width: '100%', margin: '0 auto', boxSizing: 'border-box' },
  footer: { padding: '12px 24px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#94a3b8', background: '#fff' },
  center: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: '#0f172a', color: '#e2e8f0' },
  h2: { fontSize: 18, margin: '0 0 12px' },
  h3: { fontSize: 16, margin: '0 0 8px' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, marginBottom: 12 },
  proseBox: { fontSize: 14, lineHeight: 1.6 },
  dl: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 },
  dlRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 },
  list: { listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6 },
  rowDate: { fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#475569', minWidth: 140 },
  kanban: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  col: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 8, minHeight: 200 },
  colHead: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#475569', padding: '4px 6px 8px', letterSpacing: 0.5 },
  taskCard: { background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, marginBottom: 6, fontSize: 13 },
  muted: { color: '#64748b', fontSize: 12, marginTop: 4 },
  tagPill: { display: 'inline-block', marginTop: 6, padding: '2px 6px', background: '#eef2ff', color: '#312e81', borderRadius: 999, fontSize: 11 },
  form: { display: 'grid', gap: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, maxWidth: 540 },
  label: { fontSize: 12, fontWeight: 600, color: '#334155' },
  input: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, fontFamily: 'inherit' },
  textarea: { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, fontFamily: 'inherit', resize: 'vertical' },
  btn: { padding: '6px 12px', background: '#fff', border: '1px solid #cbd5e1', color: '#0f172a', borderRadius: 6, textDecoration: 'none', fontSize: 13 },
  btnPrimary: { padding: '8px 12px', background: '#4f46e5', border: 'none', color: '#fff', borderRadius: 6, fontSize: 14, cursor: 'pointer' },
};
// ─────────────────────────────────────────────────────────────────────────────
