import * as React from 'react';
import { EntityDetailSheet } from './EntityDetailSheet';
import { eventBus } from '@/core/events';

/**
 * Global mount point for the universal EntityDetailSheet.
 *
 * Modules emit `nav:open-detail-sheet` on the bus and this host opens the
 * sheet — so no module needs to own the sheet directly. Phase C.
 */
export function EntityDetailSheetHost(): React.ReactElement {
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState(false);
  const [initialTab, setInitialTab] = React.useState<string | undefined>();

  React.useEffect(() => {
    const onOpen = ({
      id,
      initialAspectType,
    }: {
      id: string;
      initialAspectType?: string;
    }): void => {
      setEntityId(id);
      setInitialTab(initialAspectType ?? 'general');
      setOpen(true);
    };
    eventBus.on('nav:open-detail-sheet', onOpen);
    return () => {
      eventBus.off('nav:open-detail-sheet', onOpen);
    };
  }, []);

  return (
    <EntityDetailSheet
      entityId={entityId}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setEntityId(null);
      }}
      initialTab={initialTab}
    />
  );
}
