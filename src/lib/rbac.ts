/**
 * Role-based access control.
 *
 * Permissions are checked in the service layer on every mutating call — see
 * src/server/**. Hiding a button in the UI is presentation, not authorization.
 */
import type { Role } from './db/types';
import { forbidden } from './errors';

export const PERMISSIONS = [
  'org:update', 'org:delete', 'member:invite', 'member:update', 'member:remove',
  'profile:read', 'profile:update', 'profile:confirm',
  'document:read', 'document:upload', 'document:delete',
  'tender:read', 'tender:import', 'tender:delete',
  'analysis:read', 'analysis:run', 'analysis:delete',
  'weights:update',
  'draft:read', 'draft:write', 'draft:export',
  'approval:read', 'approval:request', 'approval:decide',
  'report:read', 'report:create',
  'agent:read', 'agent:cancel',
  'audit:read', 'settings:read', 'settings:update', 'billing:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const READ_ONLY: Permission[] = [
  'profile:read', 'document:read', 'tender:read', 'analysis:read', 'draft:read',
  'approval:read', 'report:read', 'agent:read', 'settings:read',
];

const ANALYST: Permission[] = [
  ...READ_ONLY,
  'document:upload', 'tender:import', 'analysis:run', 'draft:write',
  'approval:request', 'report:create', 'profile:update',
];

const REVIEWER: Permission[] = [...READ_ONLY, 'approval:decide', 'draft:write'];

const PROCUREMENT_MANAGER: Permission[] = [
  ...ANALYST, 'approval:decide', 'draft:export', 'document:delete', 'tender:delete',
  'weights:update', 'audit:read',
];

const ADMIN: Permission[] = [
  ...PROCUREMENT_MANAGER, 'member:invite', 'member:update', 'member:remove',
  'org:update', 'settings:update', 'profile:confirm', 'analysis:delete', 'billing:read',
];

const OWNER: Permission[] = [...ADMIN, 'org:delete'];

/** Deduplicated, frozen permission sets per role. */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: new Set(OWNER),
  ADMIN: new Set(ADMIN),
  PROCUREMENT_MANAGER: new Set(PROCUREMENT_MANAGER),
  ANALYST: new Set(ANALYST),
  REVIEWER: new Set(REVIEWER),
  MEMBER: new Set(READ_ONLY),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/** Throws AppError(FORBIDDEN) when the role lacks the permission. */
export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw forbidden(`Your role (${role}) cannot perform "${permission}".`);
  }
}

export const ROLE_LABELS: Record<Role, { ar: string; en: string }> = {
  OWNER: { ar: 'مالك المنشأة', en: 'Organization Owner' },
  ADMIN: { ar: 'مدير النظام', en: 'Administrator' },
  PROCUREMENT_MANAGER: { ar: 'مدير المنافسات', en: 'Procurement Manager' },
  ANALYST: { ar: 'محلل', en: 'Analyst' },
  REVIEWER: { ar: 'مراجع', en: 'Reviewer' },
  MEMBER: { ar: 'عضو (قراءة فقط)', en: 'Read-only Member' },
};
