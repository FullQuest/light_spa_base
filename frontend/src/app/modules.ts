import type { ComponentType } from 'react';
import { HomePage } from '../modules/home/HomePage';
import { ProfilePage } from '../modules/profile/ProfilePage';
import { UsersPage } from '../modules/users/UsersPage';
import { RolesPage } from '../modules/roles/RolesPage';
import { DocumentsPage } from '../modules/documents/DocumentsPage';
import { DocumentPage } from '../modules/documents/DocumentPage';

interface AppModule {
  path: string;
  title: string;
  Page: ComponentType;
  permission?: string;
  superadminOnly?: boolean;
  enabled?: boolean;
  menu?: boolean;
}

// Запись подключает меню и страницу; без ограничений раздел доступен всем вошедшим.
// enabled: false отключает страницу, menu: false только скрывает ссылку из меню.
export const features = { profile: true, users: true, roles: true, documents: true };

export const modules: AppModule[] = [
  { path: '/', title: 'Главная', Page: HomePage },
  { path: '/profile', title: 'Профиль', Page: ProfilePage, enabled: features.profile },
  { path: '/users', title: 'Пользователи', Page: UsersPage, permission: 'users.manage', enabled: features.users },
  { path: '/roles', title: 'Роли', Page: RolesPage, superadminOnly: true, enabled: features.roles },
  { path: '/documents', title: 'Документы', Page: DocumentsPage, permission: 'documents.view', enabled: features.documents },
  { path: '/documents/:id', title: 'Документ', Page: DocumentPage, permission: 'documents.view', enabled: features.documents, menu: false },
];
