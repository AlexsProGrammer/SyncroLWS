import * as React from 'react';
import { AddAspectDialog } from './AddAspectDialog';
import { eventBus } from '@/core/events';

/**
 * Global mount point for AddAspectDialog (Phase D).
 *
 * Anywhere in the app can do:
 *   eventBus.emit('nav:add-aspect', { entityId, existingTypes, initialType })
 * and this host will pop the dialog. Used by row context menus, the
 * EntityDetailSheet's "+ Add" buttons, and the command palette.
 */
export function AddAspectDialogHost(): React.ReactElement {
  const [entityId, setEntityId] = React.useState<string | null>(null);
  const [existingTypes, setExistingTypes] = React.useState<string[]>([]);
  const [initialType, setInitialType] = React.useState<string | undefined>();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onOpen = ({
      entityId: id,
      existingTypes: types,
      initialType: init,
    }: {
      entityId: string;
      existingTypes: string[];
      initialType?: string;
    }): void => {
      setEntityId(id);
      setExistingTypes(types);
      setInitialType(init);
      setOpen(true);
    };
    eventBus.on('nav:add-aspect', onOpen);
    return () => {
      eventBus.off('nav:add-aspect', onOpen);
    };
  }, []);

  if (!entityId) return <></>;

  return (
    <AddAspectDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setEntityId(null);
          setInitialType(undefined);
        }
      }}
      entityId={entityId}
      existingTypes={existingTypes}
      initialType={initialType}
    />
  );
}
