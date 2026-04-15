## Plan: SyncroLWS Enterprise Upgrade

Transform the working prototype into an enterprise-grade productivity platform by restructuring around workspaces (each with its own SQLite DB), building a manifest-based plugin architecture, upgrading all modules to professional-grade feature sets, and adding a configurable client portal with granular per-tool permissions.

---

### Phase 1 — Core Architecture Refactor (Foundation)

*All subsequent phases depend on this.*

**1.1 Workspace System (Data Layer)**
- Add `workspaces` table to the profile-level SQLite (`data.sqlite`) with `id`, `name`, `description`, `icon`, `parent_id` (for nested folder structure), `sort_order`
- Each workspace gets its **own SQLite database** at `profiles/<profile_uuid>/workspaces/<workspace_uuid>/data.sqlite` + `files/` directory
- New Rust command `create_workspace_folder` in commands.rs
- Extend db.ts with `loadWorkspaceDB(profileId, workspaceId)` and `getWorkspaceDB()` — replaces all current `getDB()` calls in modules
- New `workspaceStore.ts` (zustand + persist): tracks `activeWorkspaceId`, workspace CRUD, tree structure
- All module DB queries switch from `getDB()` → `getWorkspaceDB()`

**1.2 Profile System Enhancement**
- Extend `Profile` in profileStore.ts: add `avatar_url`, `color` fields
- New profile switcher UI component in sidebar bottom: icon + name, dropdown with all profiles + "Add Profile"
- Profile switch triggers DB close → reload → workspace list refresh

**1.3 Plugin/Tool Architecture**
- Add `manifest.json` to each module folder (`src/modules/<tool-id>/manifest.json`) defining `id`, `name`, `entityTypes[]`, `shortcut`, `hasPortalView`, `portalPermissions[]`, `configSchema`
- Refactor ToolRegistry.tsx to auto-discover manifests via `import.meta.glob()` at build time, merge with code exports (`component`, `init`, `portalComponent`)
- Standardized inter-tool interface: `getData(query)` / `setData(data)` methods + declared event bus contracts

**1.4 Workspace-Scoped Tool Instances**
- New `workspace_tools` table in workspace SQLite: users can add **multiple instances** of the same tool per workspace (e.g., two Kanban boards, each with custom name/description)
- Entity `parent_id` links entities to their tool instance
- Sidebar shows workspace tools as expandable tree

---

### Phase 2 — UI/UX Overhaul

*Parallel with Phase 3 after Phase 1 is complete.*

**2.1 Sidebar Redesign**
- Top: Workspace tree navigator (collapsible folders, drag-and-drop reorder via `@dnd-kit`)
- Middle: Active workspace's tool instance list
- Bottom: Profile switcher (avatar + name), Settings, Collapse toggle

**2.2 shadcn/ui Component Expansion**
- Add ~15 components: `Tabs`, `DropdownMenu`, `ContextMenu`, `Popover`, `DatePicker`, `Select`, `Textarea`, `Tooltip`, `Sheet`, `Table`, `Avatar`, `Separator`, `ScrollArea`, `Progress`, `Skeleton` — all local, zero CDN

**2.3 Theme & Layout**
- Dark/light theme toggle, persisted in profile settings
- Breadcrumb navigation in header: Profile → Workspace → Tool Instance
- Responsive layout for different window sizes

**2.4 Toast/Notification System**
- Toast component (bottom-right stack) wired to existing `notification:show` event bus event
- Auto-dismiss with info/warning/error variants

---

### Phase 3 — Module Upgrades

*3.1–3.4 can run in parallel after Phase 1.*

**3.1 Notes → Obsidian-like Editor**
- Extend TipTap in NoteEditor.tsx with: task lists, code blocks (syntax highlighted), tables, inline images, typography
- **Live preview mode**: cursor on a line → raw markdown; unfocused lines → rendered. Via custom TipTap NodeView decorations toggling on selection state
- Backlinks panel (new `BacklinksPanel.tsx`): shows all notes linking TO current note
- Inline `#tag` syntax highlighting + tag-based filtering in note list
- Note templates (meeting notes, daily log)

**3.2 Tasks → Full Kanban (Trello/Notion-level)**
- Rewrite TasksView.tsx: custom columns (stored in `workspace_tools.config`), swimlanes (group by assignee/priority/label)
- Task detail slide-over panel (`Sheet`): rich text description (embedded TipTap), labels with colors, due date+time → auto-creates calendar event, subtasks/checklist, file attachments, activity log/comments, assignee
- Card preview: labels, due date badge, attachment count, subtask progress bar
- Filters: by label, assignee, due date range, priority
- Extend `TaskPayload` in base-entity.ts: add `labels`, `checklist`, `column_id`, `attachments`, `comments`

**3.3 Calendar → Full Calendar View**
- Install `@fullcalendar/react` + plugins (daygrid, timegrid, interaction, list)
- New `CalendarView.tsx`: Month, Week, Day, Agenda views
- Event CRUD: click-to-create, drag to reschedule, resize
- Event detail modal with datetime picker, recurrence (RRULE via `rrule` package), location, color, linked entity
- **Cross-module**: Task due dates appear as virtual calendar events; time tracker entries as ghost blocks

**3.4 Time Tracker → Full Tracker with Billing**
- Extend TimeTrackerView.tsx: prominent start/stop button, active window detection on interval (uses existing `get_active_window` Rust command)
- Manual time entry form
- Billable flag per entry + configurable hourly rate per workspace
- Reports view (new `TimeTrackerReports.tsx`): daily/weekly/monthly bar charts via `recharts`
- CSV/PDF export (via `jspdf` for PDF — all local)

---

### Phase 4 — New Tools

*Each tool is independent, after Phase 1.*

- **4.1 File Manager**: Browse/upload workspace files, hash-based dedup, preview (images, PDFs, markdown), drag-and-drop
- **4.2 Pomodoro/Focus Timer**: Configurable intervals, integrates with time tracker, desktop notifications
- **4.3 Habit Tracker**: Daily/weekly habits, streak tracking, contribution-graph style grid
- **4.4 Bookmarks/Links**: Save URLs with tags, optional local preview

---

### Phase 5 — Sync & Backend Hardening

*Depends on Phase 1.*

**5.1 Authentication**
- JWT middleware on tRPC context in trpc.ts
- API key generation/revocation endpoints; keys stored hashed in PostgreSQL
- `express-rate-limit` on all routes

**5.2 PowerSync Integration**
- Activate PowerSync in docker-compose.yml
- Replace stub powersync.ts with real `@powersync/web` SDK
- Per-workspace sync filtering

**5.3 Workspace Sync**
- Independent sync toggle per workspace
- Selective sync: choose which tool instances to sync

**5.4 Backup System**
- ZIP export: package workspace SQLite + `files/` into `.syncrohws` archive using JSZip
- ZIP import: restore workspace from archive
- Scheduled backups with configurable interval + rotation (keep last N)

---

### Phase 6 — Client Portal

*Depends on Phase 5 (auth) and Phase 3 (module upgrades).*

**6.1 Portal Link System**
- New `portal_links` PostgreSQL table with `token`, `workspace_id`, `expires_at`, `permissions` (JSONB)
- Permissions are **per-tool-instance**: each tool instance can be set to hidden / read-only / full edit
- Additional toggles: `canUploadFiles`, `canAddNotes`, `canEditCalendar`, `canEditKanban`
- Links expire after configured duration, revocable
- Access via `https://server/portal/<token>`

**6.2 Portal Frontend**
- Extend web React app
- Reuse tool components with `readOnly` / `portalMode` props, or simplified portal-specific views
- File upload form (if permitted), note submission, calendar editing — all gated by link permissions
- Link generation UI in desktop app Settings per workspace

**6.3 Portal Security**
- Separate token validation middleware for portal routes
- CSRF protection on POST requests
- Portal tokens scoped to specific workspace + permissions only — no admin access

---

### Phase 7 — Polish & Enterprise Features

- **7.1 Search**: FTS5 search per workspace, results grouped by type, enhanced command palette with recent items + workspace switcher
- **7.2 Deep Linking**: `syncrohws://workspace/<id>`, `syncrohws://workspace/<id>/tool/<instance-id>`
- **7.3 Global Tags**: Cross-entity-type tag system, autocomplete, tag-based filtering, optional backlink graph visualization
- **7.4 Keyboard Shortcuts**: Full keyboard navigation, customizable shortcuts in profile settings
- **7.5 Performance**: Virtual scrolling via `@tanstack/react-virtual`, `React.lazy()` + `Suspense` for tool components, SQLite WAL mode

---

### Relevant Files

| Area | File | What to change |
|------|------|----------------|
| Core | db.ts | Add workspace DB management |
| Core | profileStore.ts | Extend Profile type |
| Core | ToolRegistry.tsx | Manifest-based auto-discovery |
| Core | commands.rs | Add `create_workspace_folder` |
| Core | schema.ts | Add `workspaces`, `workspace_tools` tables |
| Core | base-entity.ts | Extend entity types + payloads |
| Core | events.ts | Add workspace/portal events |
| UI | Sidebar.tsx | Complete redesign |
| UI | App.tsx | Workspace context, breadcrumbs |
| Notes | NoteEditor.tsx | TipTap extension overhaul |
| Tasks | TasksView.tsx | Full Kanban rewrite |
| Calendar | calendar | New CalendarView with FullCalendar |
| Timer | TimeTrackerView.tsx | Reports, billing |
| Backend | trpc.ts | Auth middleware |
| Backend | schema.ts | Portal + auth tables |
| Portal | web | Portal frontend |

---

### Verification

1. **Phase 1**: Create workspace → separate SQLite exists at expected path. Switch workspace → data is isolated. Profile switch → reloads workspace list. Rust commands work via `invoke()`.
2. **Phase 2**: Sidebar renders workspace tree. Profile switcher works. All shadcn components render. Theme persists.
3. **Phase 3**: Note with wikilinks/code/tables renders. Kanban custom columns + task detail panel + auto-calendar integration. FullCalendar month/week/day views. Timer start/stop + CSV export.
4. **Phase 5**: API key auth flow works. PowerSync syncs entities. ZIP backup export → import on clean install restores data.
5. **Phase 6**: Portal link with kanban=read-only, calendar=editable → browser shows kanban (no edit), calendar (edit works). Expired link → 403.
6. **Phase 7**: FTS search returns grouped results across entity types. `syncrohws://workspace/<id>` opens correct workspace. 10k items → virtual scrolling smooth.

---

### Decisions

- **Separate SQLite per workspace** for clean isolation, easier backup/sync per workspace
- **TipTap extended** — leverages existing integration, ProseMirror ecosystem
- **FullCalendar.js** — most feature-complete, native drag-and-drop
- **JWT + API key** — matches existing Settings UI setup
- **Config-based manifest registry** — auto-discovery at build time, no runtime eval
- **Granular portal permissions** — per-tool-instance visibility + edit control, link-based with expiry
- **Zero CDN policy maintained** — all libs bundled via npm

### Scope Boundaries

- **Included**: Workspaces, profiles, all module upgrades, plugin system, sync, portal, backup, search, deep linking, performance
- **Excluded (for now)**: Privacy-first AI integration, automated invoicing engine (beyond CSV/PDF export), mobile app, multi-language i18n