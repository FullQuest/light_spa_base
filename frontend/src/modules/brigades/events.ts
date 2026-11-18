export const formationResetEvent = 'repair-data-reset';

export function invalidateFormationResults() {
  // Backend deletes persisted jobs/results; this notifies open browser tabs.
  try { localStorage.setItem('repair-mock:revision', `${Date.now()}-${Math.random()}`); }
  catch { /* Same-tab notification still works without local storage. */ }
  window.dispatchEvent(new Event(formationResetEvent));
}
