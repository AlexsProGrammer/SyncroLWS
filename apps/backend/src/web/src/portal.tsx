// ─────────────────────────────────────────────────────────────────────────────
// Phase I placeholder: the public client portal will be reintroduced in
// Phase M against the new sync-aware schema. The legacy entities.list route
// has been removed (Phase I rewrite of the trpc router) so this view simply
// renders a friendly notice rather than a broken table.
// ─────────────────────────────────────────────────────────────────────────────
export function Portal() {
  return (
    <main style={s.shell}>
      <h1 style={s.title}>SyncroLWS Client Portal</h1>
      <p style={s.lead}>
        The shared client portal is being rebuilt on top of the new sync
        protocol. It will return in Phase M with read/write access scoped by
        share-link tokens.
      </p>
    </main>
  );
}

const s = {
  shell: {
    minHeight: '100vh',
    padding: '64px 24px',
    background: '#0f172a',
    color: '#e2e8f0',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: 28,
    fontWeight: 600,
    margin: '0 0 12px',
  },
  lead: {
    maxWidth: 540,
    fontSize: 15,
    lineHeight: 1.55,
    color: '#94a3b8',
  },
};
