import { lazy } from 'react';
import type { ComponentType } from 'react';
import type { UserPublic } from '../auth/types';
import { HomePage } from '../modules/home/HomePage';
const GraphPage = lazy(() => import('../modules/graph/GraphPage').then(module => ({ default: module.GraphPage })));
const EventArchivePage = lazy(() => import('../modules/events/EventArchivePage').then(module => ({ default: module.EventArchivePage })));
const DatabaseSyncPage = lazy(() => import('../modules/events/DatabaseSyncPage').then(module => ({ default: module.DatabaseSyncPage })));

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
export const features = { profile: true, users: true, roles: true, documents: true, search: true, sources: true, requests: true };

export const modules: AppModule[] = [
  { path: '/', title: 'Главная', Page: HomePage },
  { path: '/graph', title: 'Схема', Page: GraphPage },
  { path: '/events/archive', title: 'Архив событий', Page: EventArchivePage },
  { path: '/infrastructure/data', title: 'Данные графа', Page: DatabaseSyncPage, superadminOnly: true },
  // { path: '/profile', title: 'Профиль', Page: ProfilePage, enabled: features.profile },
  // { path: '/users', title: 'Пользователи', Page: UsersPage, permission: 'users.manage', enabled: features.users },
  // { path: '/roles', title: 'Роли', Page: RolesPage, superadminOnly: true, enabled: features.roles },
  // { path: '/documents', title: 'Документы', Page: DocumentsPage, permission: 'documents.view', enabled: features.documents },
  // { path: '/documents/:id', title: 'Документ', Page: DocumentPage, permission: 'documents.view', enabled: features.documents, menu: false },
  // { path: '/search', title: 'Поиск', Page: SearchPage, permission: 'documents.view', enabled: features.search && features.documents },
  // { path: '/sources', title: 'Источники', Page: SourcesPage, permission: 'sources.view', enabled: features.sources },
  // { path: '/sources/:id', title: 'Источник', Page: SourcePage, permission: 'sources.view', enabled: features.sources, menu: false },
  // { path: '/requests', title: 'Заявки', Page: RequestsPage, permission: 'requests.view', enabled: features.requests },
  // { path: '/requests/:id', title: 'Заявка', Page: RequestPage, permission: 'requests.view', enabled: features.requests, menu: false },
];
