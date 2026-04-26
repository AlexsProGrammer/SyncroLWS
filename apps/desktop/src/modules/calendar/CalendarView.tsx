import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import listPlugin from '@fullcalendar/list';
import rrulePlugin from '@fullcalendar/rrule';
import type {
  EventInput,
  EventClickArg,
  DateSelectArg,
  EventDropArg,
} from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { eventBus } from '@/core/events';
import {
  createEntity,
  listByAspect,
  updateAspect,
  type AspectWithCore,
} from '@/core/entityStore';
import { Button } from '@/ui/components/button';
import type {
  CalendarEventAspectData,
  TaskAspectData,
  TimeLogAspectData,
} from '@syncrohws/shared-types';

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = 'dayGridMonth' | 'timeGridWeek' | 'timeGridDay' | 'listWeek';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * FullCalendar gives date-only strings ("2026-04-26") for all-day events.
 * CalendarEventAspectDataSchema requires full ISO 8601 datetimes, so we
 * normalise any bare date string to midnight UTC.
 */
function toISOStr(s: string): string {
  return s.includes('T') ? s : new Date(s).toISOString();
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CalendarView(): React.ReactElement {
  const calRef = useRef<FullCalendar>(null);
  const [events, setEvents] = useState<AspectWithCore[]>([]);
  const [taskEvents, setTaskEvents] = useState<EventInput[]>([]);
  const [timeLogEvents, setTimeLogEvents] = useState<EventInput[]>([]);
  const [currentView, setCurrentView] = useState<ViewMode>('dayGridMonth');

  // ── Load calendar events ──────────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    try {
      const items = await listByAspect('calendar_event');
      setEvents(items);
    } catch (err) {
      console.error('[calendar] load failed:', err);
    }
  }, []);

  // ── Load cross-module ghost events ────────────────────────────────────────

  const loadCrossModuleEvents = useCallback(async () => {
    try {
      const taskItems = await listByAspect('task');
      const tasks: EventInput[] = [];
      for (const t of taskItems) {
        const data = t.aspect.data as Partial<TaskAspectData>;
        if (data.due_date) {
          tasks.push({
            id: `task__${t.core.id}`,
            title: `📋 ${t.core.title}`,
            start: data.due_date,
            allDay: true,
            backgroundColor: '#6366f1',
            borderColor: '#6366f1',
            textColor: '#fff',
            editable: false,
            extendedProps: { sourceType: 'task', sourceId: t.core.id },
          });
        }
      }
      setTaskEvents(tasks);

      const logItems = await listByAspect('time_log');
      const logs: EventInput[] = [];
      for (const l of logItems) {
        const data = l.aspect.data as Partial<TimeLogAspectData>;
        if (data.start && data.end) {
          logs.push({
            id: `timelog__${l.core.id}`,
            title: `⏱ ${l.core.title || 'Time log'}`,
            start: data.start,
            end: data.end,
            backgroundColor: 'rgba(34, 197, 94, 0.15)',
            borderColor: '#22c55e',
            textColor: '#22c55e',
            editable: false,
            display: 'background',
            extendedProps: { sourceType: 'time_log', sourceId: l.core.id },
          });
        }
      }
      setTimeLogEvents(logs);
    } catch (err) {
      console.error('[calendar] cross-module load failed:', err);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
    void loadCrossModuleEvents();
  }, [loadEvents, loadCrossModuleEvents]);

  useEffect(() => {
    const handler = (): void => {
      void loadEvents();
      void loadCrossModuleEvents();
    };
    eventBus.on('core:created', handler);
    eventBus.on('core:updated', handler);
    eventBus.on('core:deleted', handler);
    eventBus.on('aspect:added', handler);
    eventBus.on('aspect:updated', handler);
    eventBus.on('aspect:removed', handler);
    eventBus.on('entity:created', handler);
    eventBus.on('entity:updated', handler);
    eventBus.on('entity:deleted', handler);
    return () => {
      eventBus.off('core:created', handler);
      eventBus.off('core:updated', handler);
      eventBus.off('core:deleted', handler);
      eventBus.off('aspect:added', handler);
      eventBus.off('aspect:updated', handler);
      eventBus.off('aspect:removed', handler);
      eventBus.off('entity:created', handler);
      eventBus.off('entity:updated', handler);
      eventBus.off('entity:deleted', handler);
    };
  }, [loadEvents, loadCrossModuleEvents]);

  // ── FullCalendar input ────────────────────────────────────────────────────

  const fcEvents: EventInput[] = useMemo(() => {
    const calEvents: EventInput[] = events.map((e) => {
      const data = e.aspect.data as Partial<CalendarEventAspectData>;
      const start = data.start ?? new Date().toISOString();
      const end = data.end ?? start;
      const base: EventInput = {
        id: e.core.id,
        title: e.core.title,
        start,
        end,
        allDay: data.all_day ?? false,
        backgroundColor: e.core.color,
        borderColor: e.core.color,
        extendedProps: {
          sourceType: 'calendar_event',
          sourceId: e.core.id,
          aspectId: e.aspect.id,
          location: data.location,
          description: e.core.description,
        },
      };
      if (data.recurrence_rule) {
        base.rrule = data.recurrence_rule;
        const ms = new Date(end).getTime() - new Date(start).getTime();
        base.duration = { milliseconds: ms > 0 ? ms : 3600000 };
      }
      return base;
    });
    return [...calEvents, ...taskEvents, ...timeLogEvents];
  }, [events, taskEvents, timeLogEvents]);

  // ── Quick create ──────────────────────────────────────────────────────────

  const quickCreate = useCallback(
    async (start: string, end: string, allDay: boolean) => {
      try {
        // FullCalendar all-day selections give date-only strings ("2026-04-26").
        // Normalise to full ISO datetimes required by CalendarEventAspectDataSchema.
        const startISO = toISOStr(start);
        // All-day end from FullCalendar is exclusive (next day); shift to
        // end-of-day of the last day so the stored range is inclusive.
        let endISO = toISOStr(end);
        if (allDay && !end.includes('T')) {
          const d = new Date(end);
          d.setDate(d.getDate() - 1);
          d.setHours(23, 59, 59, 999);
          endISO = d.toISOString();
        }
        const created = await createEntity({
          core: { title: 'New event', color: '#3b82f6' },
          aspects: [
            {
              aspect_type: 'calendar_event',
              data: { start: startISO, end: endISO, all_day: allDay },
            },
          ],
        });
        eventBus.emit('nav:open-detail-sheet', {
          id: created.core.id,
          initialAspectType: 'calendar_event',
        });
      } catch (err) {
        console.error('[calendar] create failed:', err);
      }
    },
    [],
  );

  // ── FullCalendar callbacks ────────────────────────────────────────────────

  const handleDateSelect = useCallback(
    (selectInfo: DateSelectArg) => {
      void quickCreate(selectInfo.startStr, selectInfo.endStr, selectInfo.allDay);
      selectInfo.view.calendar.unselect();
    },
    [quickCreate],
  );

  const handleEventClick = useCallback((clickInfo: EventClickArg) => {
    const props = clickInfo.event.extendedProps;
    if (props.sourceType === 'task') {
      eventBus.emit('nav:open-detail-sheet', {
        id: props.sourceId as string,
        initialAspectType: 'task',
      });
      return;
    }
    if (props.sourceType === 'time_log') {
      eventBus.emit('nav:open-detail-sheet', {
        id: props.sourceId as string,
        initialAspectType: 'time_log',
      });
      return;
    }
    eventBus.emit('nav:open-detail-sheet', {
      id: clickInfo.event.id,
      initialAspectType: 'calendar_event',
    });
  }, []);

  const handleEventDrop = useCallback(
    (dropInfo: EventDropArg) => {
      const props = dropInfo.event.extendedProps;
      if (props.sourceType !== 'calendar_event') {
        dropInfo.revert();
        return;
      }
      const aspectId = props.aspectId as string | undefined;
      if (!aspectId) return;
      void updateAspect(aspectId, {
        data: {
          start: toISOStr(dropInfo.event.startStr),
          end: toISOStr(dropInfo.event.endStr || dropInfo.event.startStr),
          all_day: dropInfo.event.allDay,
        },
      }).catch((err) => console.error('[calendar] drop save failed:', err));
    },
    [],
  );

  const handleEventResize = useCallback((resizeInfo: EventResizeDoneArg) => {
    const props = resizeInfo.event.extendedProps;
    if (props.sourceType !== 'calendar_event') return;
    const aspectId = props.aspectId as string | undefined;
    if (!aspectId) return;
    void updateAspect(aspectId, {
      data: {
        start: toISOStr(resizeInfo.event.startStr),
        end: toISOStr(resizeInfo.event.endStr || resizeInfo.event.startStr),
      },
    }).catch((err) => console.error('[calendar] resize save failed:', err));
  }, []);

  // ── View navigation ──────────────────────────────────────────────────────

  const changeView = useCallback((view: ViewMode) => {
    setCurrentView(view);
    calRef.current?.getApi().changeView(view);
  }, []);
  const goToday = useCallback(() => calRef.current?.getApi().today(), []);
  const goPrev = useCallback(() => calRef.current?.getApi().prev(), []);
  const goNext = useCallback(() => calRef.current?.getApi().next(), []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      {/* ── Toolbar ────────────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={goPrev} className="h-8 px-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="15,18 9,12 15,6" />
            </svg>
          </Button>
          <Button variant="outline" size="sm" onClick={goToday} className="h-8 px-3 text-xs">
            Today
          </Button>
          <Button variant="outline" size="sm" onClick={goNext} className="h-8 px-2">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <polyline points="9,18 15,12 9,6" />
            </svg>
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {(
            [
              ['dayGridMonth', 'Month'],
              ['timeGridWeek', 'Week'],
              ['timeGridDay', 'Day'],
              ['listWeek', 'Agenda'],
            ] as const
          ).map(([view, label]) => (
            <Button
              key={view}
              variant={currentView === view ? 'default' : 'outline'}
              size="sm"
              onClick={() => changeView(view)}
              className="h-8 px-3 text-xs"
            >
              {label}
            </Button>
          ))}
        </div>

        <Button
          size="sm"
          onClick={() => {
            const start = new Date().toISOString();
            const end = new Date(Date.now() + 3600000).toISOString();
            void quickCreate(start, end, false);
          }}
          className="h-8"
        >
          + New Event
        </Button>
      </div>

      {/* ── Calendar ───────────────────────────────────────────────── */}
      <div className="calendar-wrapper flex-1 overflow-auto">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin, listPlugin, rrulePlugin]}
          initialView={currentView}
          headerToolbar={false}
          events={fcEvents}
          selectable
          editable
          eventResizableFromStart
          selectMirror
          dayMaxEvents={3}
          nowIndicator
          select={handleDateSelect}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          eventResize={handleEventResize}
          height="100%"
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            meridiem: false,
            hour12: false,
          }}
        />
      </div>
    </div>
  );
}
