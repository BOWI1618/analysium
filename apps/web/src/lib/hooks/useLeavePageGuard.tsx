import { useRef } from 'react';
import { useBlocker } from 'react-router-dom';
import { ConfirmDialog, useBeforeUnloadWarning } from '~/ui/Dialog';

/**
 * A page with a form that is filled in but not submitted: leaving it for
 * another page, or closing the tab, asks first.
 *
 * Call `allowLeave()` right before navigating away on purpose — after a
 * successful save — so that navigation is not questioned.
 */
export function useLeavePageGuard(dirty: boolean) {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useBeforeUnloadWarning(dirty);

  const dialog = (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      onClose={() => blocker.reset?.()}
      onConfirm={() => blocker.proceed?.()}
      title="Уйти без сохранения?"
      message="Введённые данные не сохранятся."
      confirmLabel="Уйти"
      cancelLabel="Остаться"
      danger
      safeDefault
    />
  );

  return {
    allowLeave: () => {
      allowed.current = true;
    },
    dialog,
  };
}
