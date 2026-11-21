'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';

const FeedbackContext = createContext(null);

export function ActionFeedback({ children }) {
  const [notice, setNotice] = useState(null);
  const announce = (message) => setNotice((previous) => ({
    message,
    revision: (previous?.revision ?? 0) + 1,
  }));

  return (
    <FeedbackContext.Provider value={announce}>
      {children}
      <div role="status" className="pointer-events-none fixed inset-x-5 bottom-5 z-10 flex justify-end">
        {notice && (
          <p key={notice.revision} className="motion-notice panel text-sm font-medium text-accent">
            {notice.message}
          </p>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}

export function ActionButton({ children, value, secondary = false }) {
  const { pending, data } = useFormStatus();
  const busy = pending && (!value || data?.get('operation') === value);
  return (
    <button className={`btn ${secondary ? 'secondary' : ''}`} name={value ? 'operation' : undefined} value={value} disabled={pending} aria-busy={busy}>
      <span className="motion-button-label">{children}</span>
      {busy && <span className="motion-spinner" aria-hidden="true" />}
    </button>
  );
}

export default function ActionForm({ action, children, className = 'space-y-3', reset = false, initialState = null, announceApproval = false }) {
  const announce = useContext(FeedbackContext);
  const [enhanced, setEnhanced] = useState(false);
  useEffect(() => {
    if (announceApproval) setEnhanced(true);
  }, [announceApproval]);

  async function submit(previous, data) {
    const result = await action(previous, data);
    if (result?.ok && data.get('operation') === 'approve') {
      announce('审核通过，资料已公开。');
    }
    return result;
  }

  const [state, formAction] = useFormState(enhanced && announce ? submit : action, initialState);
  const form = useRef(null);
  useEffect(() => {
    if (state?.ok && reset) form.current?.reset();
  }, [state, reset]);

  return (
    <form ref={form} className={className} action={formAction}>
      {children}
      {state?.message && <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'motion-feedback text-sm font-medium text-accent' : 'border-l-2 border-ink pl-3 text-sm font-semibold text-ink'}>{state.message}</p>}
    </form>
  );
}
