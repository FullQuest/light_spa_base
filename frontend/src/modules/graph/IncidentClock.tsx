import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatDuration } from './incidents';
const Clock = createContext(0);
// Один таймер на страницу; пересчитываются только подписи времени, не геометрия.
export function IncidentClock({ children, at }: { children: ReactNode; at?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (at) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [at]);
  return <Clock.Provider value={at ? Date.parse(at) : now}>{children}</Clock.Provider>;
}
export function IncidentDuration({ since }: { since: string }) {
  const now = useContext(Clock);
  return <time className="incident-duration" dateTime={since} title={`Начало: ${new Date(since).toLocaleString('ru-RU')}`}>◷ {formatDuration(since, now)}</time>;
}
