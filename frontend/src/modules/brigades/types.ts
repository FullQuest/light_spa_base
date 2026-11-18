import type { Employee } from '../workforce/types.ts';

export interface Brigade { brigadeId: number; employeeIds: number[] }
export interface ScheduledIncident {
  eventId: number;
  objectId: number;
  objectName: string;
  resourceType: string;
  occurredAt: string;
  startAt: string;
  finishAt: string;
  baseDurationSeconds: number;
  actualDurationSeconds: number;
  brigadeId: number;
  sequence: number;
}
export interface FormationResult {
  id: string;
  generatedAt: string;
  dataRevision: string;
  employees: Employee[];
  brigades: Brigade[];
  incidents: ScheduledIncident[];
  conflictModel?: 'zero';
}
export interface FormationJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number | null;
  stage: string;
  error?: string;
  result?: FormationResult;
}
export interface M2Export { brigades: { brigade_id: number; employees: number[]; event_order: number[] }[] }
