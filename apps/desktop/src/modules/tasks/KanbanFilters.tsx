import React from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/components/select';
import { Input } from '@/ui/components/input';
import { Button } from '@/ui/components/button';
import { cn } from '@/lib/utils';
import type { TaskLabel } from '@syncrohws/shared-types';

export interface KanbanFilterState {
  search: string;
  priority: string;
  assignee: string;
  labelId: string;
  groupBy: 'none' | 'priority' | 'assignee' | 'label';
}

export const DEFAULT_FILTERS: KanbanFilterState = {
  search: '',
  priority: '',
  assignee: '',
  labelId: '',
  groupBy: 'none',
};

interface KanbanFiltersProps {
  filters: KanbanFilterState;
  onChange: (filters: KanbanFilterState) => void;
  allLabels: TaskLabel[];
  allAssignees: string[];
}

export function KanbanFilters({
  filters,
  onChange,
  allLabels,
  allAssignees,
}: KanbanFiltersProps): React.ReactElement {
  const hasFilters =
    filters.search || filters.priority || filters.assignee || filters.labelId;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Search */}
      <Input
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        placeholder="Search tasks…"
        className="h-8 w-48 text-xs"
      />

      {/* Priority filter */}
      <Select
        value={filters.priority}
        onValueChange={(v) => onChange({ ...filters, priority: v === '_all' ? '' : v })}
      >
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue placeholder="Priority" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="_all">All priorities</SelectItem>
          <SelectItem value="low">Low</SelectItem>
          <SelectItem value="medium">Medium</SelectItem>
          <SelectItem value="high">High</SelectItem>
          <SelectItem value="urgent">Urgent</SelectItem>
        </SelectContent>
      </Select>

      {/* Assignee filter */}
      {allAssignees.length > 0 && (
        <Select
          value={filters.assignee}
          onValueChange={(v) => onChange({ ...filters, assignee: v === '_all' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue placeholder="Assignee" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All assignees</SelectItem>
            {allAssignees.map((a) => (
              <SelectItem key={a} value={a}>{a}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Label filter */}
      {allLabels.length > 0 && (
        <Select
          value={filters.labelId}
          onValueChange={(v) => onChange({ ...filters, labelId: v === '_all' ? '' : v })}
        >
          <SelectTrigger className="h-8 w-28 text-xs">
            <SelectValue placeholder="Label" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All labels</SelectItem>
            {allLabels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                <span className="flex items-center gap-1">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  {l.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Group by */}
      <Select
        value={filters.groupBy}
        onValueChange={(v) =>
          onChange({ ...filters, groupBy: v as KanbanFilterState['groupBy'] })
        }
      >
        <SelectTrigger className="h-8 w-28 text-xs">
          <SelectValue placeholder="Group by" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No grouping</SelectItem>
          <SelectItem value="priority">Priority</SelectItem>
          <SelectItem value="assignee">Assignee</SelectItem>
          <SelectItem value="label">Label</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange({ ...DEFAULT_FILTERS, groupBy: filters.groupBy })}
          className="h-8 px-2 text-xs"
        >
          Clear
        </Button>
      )}
    </div>
  );
}
