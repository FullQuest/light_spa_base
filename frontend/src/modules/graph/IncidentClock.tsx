import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { formatDuration } from './incidents';
const Clock = createContext(0);
// Один таймер на страницу; пересчитываются только подписи времени, не геометрия.
export function IncidentClock({ children }: { children: ReactNode }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  return <Clock.Provider value={now}>{children}</Clock.Provider>;
}
export function IncidentDuration({ since }: { since: string }) {
  const now = useContext(Clock);
  return <time className="incident-duration" dateTime={since} title={`Начало: ${new Date(since).toLocaleString('ru-RU')}`}>◷ {formatDuration(since, now)}</time>;
}
