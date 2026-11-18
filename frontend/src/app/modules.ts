import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { UserPublic } from '../auth/types';
const GraphPage = lazy(() => import('../modules/graph/GraphPage').then(module => ({ default: module.GraphPage })));
const GraphArchivePage = lazy(() => import('../modules/graph/GraphArchivePage').then(module => ({ default: module.GraphArchivePage })));
const EventArchivePage = lazy(() => import('../modules/events/EventArchivePage').then(module => ({ default: module.EventArchivePage })));
const DatabaseSyncPage = lazy(() => import('../modules/events/DatabaseSyncPage').then(module => ({ default: module.DatabaseSyncPage })));
const WorkersPage = lazy(() => import('../modules/workforce/WorkersPage').then(module => ({ default: module.WorkersPage })));
const BrigadesPage = lazy(() => import('../modules/brigades/BrigadesPage').then(module => ({ default: module.BrigadesPage })));

interface AppModule {
  path: string;
  title: string;
  Page: ComponentType;
  permission?: string;
  superadminOnly?: boolean;
  enabled?: boolean;
  menu?: boolean;
}

// Общие правила для меню, маршрутов и перехода после входа.
export function canOpenModule(module: AppModule, user: UserPublic) {
  return module.enabled !== false &&
    (!module.superadminOnly || user.role === 'superadmin') &&
    (!module.permission || user.permissions.includes(module.permission));
}

// Запись подключает меню и страницу; без ограничений раздел доступен всем вошедшим.
// enabled: false отключает страницу, menu: false только скрывает ссылку из меню.
export const modules: AppModule[] = [
  { path: '/graph', title: 'Схема', Page: GraphPage },
  { path: '/graph/archive', title: 'Архив схемы', Page: GraphArchivePage },
  { path: '/events/archive', title: 'Архив событий', Page: EventArchivePage },
  { path: '/workers', title: 'Рабочие', Page: WorkersPage },
  { path: '/brigades', title: 'Формирование бригад', Page: BrigadesPage },
  { path: '/infrastructure/data', title: 'Данные графа', Page: DatabaseSyncPage, superadminOnly: true },
];
