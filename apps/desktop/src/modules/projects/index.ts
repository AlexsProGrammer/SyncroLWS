import type { HybridEntity, ProjectAspectData } from '@syncrohws/shared-types';

export { ProjectsView } from './ProjectsView';
export { AspectEditor } from './AspectEditor';

function projectData(entity: HybridEntity): Partial<ProjectAspectData> {
  return (entity.aspects.find((a) => a.aspect_type === 'project')?.data ?? {}) as Partial<ProjectAspectData>;
}

export function getEntityTitle(entity: HybridEntity): string {
  return entity.core.title || 'Untitled Project';
}

export function getEntitySubtitle(entity: HybridEntity): string | undefined {
  const data = projectData(entity);
  const parts: string[] = [];
  if (data.status) parts.push(data.status.replace('_', ' '));
  if (data.due_date) {
    try {
      parts.push(`due ${new Date(data.due_date).toLocaleDateString()}`);
    } catch {
      // ignore
    }
  }
  if (Array.isArray(data.milestones) && data.milestones.length > 0) {
    const done = data.milestones.filter((m) => m.done).length;
    parts.push(`${done}/${data.milestones.length} milestones`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export function init(): void {
  console.log('[module:projects] initialised');
}
