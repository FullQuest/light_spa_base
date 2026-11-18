import { authRequest } from '../../auth/api';
import type { Employee } from '../workforce/types';
import type { FormationJob, FormationResult } from './types';
import { mockFormationApi } from './mockApi';

// HTTP is the default. Mock requires an explicit opt-in.
export const isMockApi = import.meta.env.VITE_REPAIR_API_MODE === 'mock';
export const formationApi = isMockApi ? mockFormationApi : {
  employees: (signal?: AbortSignal) => authRequest<Employee[]>('/workforce/employees', { signal, cache: 'no-store' }),
  result: (_scope: string, signal?: AbortSignal) => authRequest<FormationResult | null>('/brigades/result', { signal, cache: 'no-store' }),
  currentJob: (_scope: string, signal?: AbortSignal) => authRequest<FormationJob | null>('/brigades/jobs/current', { signal, cache: 'no-store' }),
  start: (_scope: string, signal?: AbortSignal) => authRequest<FormationJob>('/brigades/jobs', { method: 'POST', signal }),
  job: (_scope: string, id: string, signal?: AbortSignal) => authRequest<FormationJob>(`/brigades/jobs/${encodeURIComponent(id)}`, { signal, cache: 'no-store' }),
};
