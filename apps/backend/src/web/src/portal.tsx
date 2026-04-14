import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BaseEntity {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  tags: string[];
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TRPCResponse<T> {
  result: { data: T };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read `:projectId` from the current pathname (e.g. /portal/abc-123). */
function getProjectId(): string {
  const match = window.location.pathname.match(/\/portal\/([^/]+)/);
  return match?.[1] ?? '';
}

async function fetchEntities(projectId: string): Promise<BaseEntity[]> {
  const input: Record<string, unknown> = { limit: 500, offset: 0 };
  if (UUID_RE.test(projectId)) {
    input['parent_id'] = projectId;
  }
  const url = `/trpc/entities.list?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Server responded with ${res.status}`);
  const json = (await res.json()) as TRPCResponse<BaseEntity[]>;
  return json.result.data;
}

const TYPE_META: Record<string, { label: string; color: string }> = {
  note:           { label: 'Notes',          color: '#6366f1' },
  task:           { label: 'Tasks',          color: '#0ea5e9' },
  calendar_event: { label: 'Calendar Events', color: '#10b981' },
  time_log:       { label: 'Time Logs',      color: '#f59e0b' },
};

function typeMeta(type: string) {
  return TYPE_META[type] ?? { label: type, color: '#64748b' };
}

// ── Components ────────────────────────────────────────────────────────────────

function EntityCard({ entity }: { entity: BaseEntity }) {
  const meta = typeMeta(entity.type);
  return (
    <div style={{ ...s.card, borderLeft: `4px solid ${meta.color}` }}>
      <div style={s.cardHeader}>
        <span
          style={{ ...s.badge, background: meta.color + '22', color: meta.color }}
        >
          {meta.label}
        </span>
        {entity.tags.length > 0 && (
          <span style={s.tags}>{entity.tags.map((t) => `#${t}`).join(' ')}</span>
        )}
        <span style={s.date}>{new Date(entity.updated_at).toLocaleString()}</span>
      </div>
      <div style={s.entityId}>{entity.id}</div>
      {Object.keys(entity.payload).length > 0 && (
        <pre style={s.payload}>{JSON.stringify(entity.payload, null, 2)}</pre>
      )}
    </div>
  );
}

function Section({ type, entities }: { type: string; entities: BaseEntity[] }) {
  const meta = typeMeta(type);
  return (
    <section style={s.section} aria-label={meta.label}>
      <h2 style={{ ...s.h2, color: meta.color }}>
        {meta.label}
        <span style={s.count}>{entities.length}</span>
      </h2>
      {entities.map((e) => (
        <EntityCard key={e.id} entity={e} />
      ))}
    </section>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export function Portal() {
  const projectId = getProjectId();
  const isUUID = UUID_RE.test(projectId);

  const [entities, setEntities] = useState<BaseEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetchEntities(projectId)
      .then(setEntities)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setLoading(false));
  }, [projectId]);

  // Group by type, preserving first-seen insertion order
  const byType: Map<string, BaseEntity[]> = new Map();
  for (const e of entities) {
    const bucket = byType.get(e.type) ?? [];
    bucket.push(e);
    byType.set(e.type, bucket);
  }

  return (
    <div style={s.root}>
      {/* ── Header ── */}
      <header style={s.header}>
        <div>
          <h1 style={s.h1}>SyncroLWS Portal</h1>
          <p style={s.subtitle}>
            {isUUID ? (
              <>
                Project <code style={s.code}>{projectId}</code>
              </>
            ) : (
              'All Entities'
            )}
          </p>
        </div>
        {!loading && (
          <span style={s.totalBadge}>{entities.length} entities</span>
        )}
      </header>

      {/* ── Body ── */}
      <main>
        {loading && <div style={s.center}>Loading…</div>}

        {!loading && error && (
          <div style={s.errorBox}>
            <strong>Error:</strong> {error}
          </div>
        )}

        {!loading && !error && entities.length === 0 && (
          <div style={s.empty}>
            <p style={{ margin: 0 }}>No entities found for this project.</p>
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
              Create entities via the tRPC API with{' '}
              <code style={s.code}>
                parent_id: &quot;{projectId}&quot;
              </code>
            </p>
          </div>
        )}

        {!loading &&
          !error &&
          Array.from(byType.entries()).map(([type, items]) => (
            <Section key={type} type={type} entities={items} />
          ))}
      </main>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Inline-only — zero external CSS, fonts, or CDN. GDPR compliant.

const s = {
  root: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    maxWidth: 900,
    margin: '0 auto',
    padding: '2rem 1.25rem',
    color: '#1e293b',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottom: '2px solid #e2e8f0',
    paddingBottom: '1.25rem',
    marginBottom: '2rem',
    flexWrap: 'wrap' as const,
    gap: '0.75rem',
  },
  h1: { margin: 0, fontSize: '1.75rem', fontWeight: 700, letterSpacing: '-0.02em' },
  subtitle: { margin: '0.25rem 0 0', color: '#64748b', fontSize: '0.95rem' },
  totalBadge: {
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 20,
    padding: '0.3rem 0.9rem',
    fontSize: '0.85rem',
    color: '#475569',
    alignSelf: 'center',
    whiteSpace: 'nowrap' as const,
  },
  center: {
    textAlign: 'center' as const,
    padding: '4rem 0',
    color: '#94a3b8',
    fontSize: '1.1rem',
  },
  errorBox: {
    background: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    color: '#dc2626',
  },
  empty: {
    textAlign: 'center' as const,
    padding: '4rem 0',
    color: '#64748b',
    fontSize: '1rem',
  },
  section: { marginBottom: '2.5rem' },
  h2: {
    margin: '0 0 1rem',
    fontSize: '1.1rem',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  count: {
    background: '#f1f5f9',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '0 0.5rem',
    fontSize: '0.8rem',
    color: '#64748b',
    fontWeight: 500,
  },
  card: {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    padding: '0.875rem 1rem',
    marginBottom: '0.75rem',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.4rem',
    flexWrap: 'wrap' as const,
  },
  badge: {
    borderRadius: 4,
    padding: '0.1rem 0.45rem',
    fontSize: '0.75rem',
    fontWeight: 600,
  },
  tags: { fontSize: '0.8rem', color: '#7c3aed', flexGrow: 1 },
  date: { fontSize: '0.72rem', color: '#94a3b8', marginLeft: 'auto', whiteSpace: 'nowrap' as const },
  entityId: {
    fontSize: '0.68rem',
    color: '#94a3b8',
    fontFamily: 'ui-monospace, monospace',
    marginBottom: '0.5rem',
  },
  payload: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    padding: '0.5rem 0.75rem',
    fontSize: '0.78rem',
    overflow: 'auto',
    margin: 0,
    color: '#334155',
    lineHeight: 1.5,
  },
  code: {
    background: '#f1f5f9',
    borderRadius: 3,
    padding: '0.1rem 0.35rem',
    fontFamily: 'ui-monospace, monospace',
    fontSize: '0.875em',
  },
} as const;
