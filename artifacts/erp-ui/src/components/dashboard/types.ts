import type { ComponentType } from 'react';
import type { AppRole, NavSection } from '@/lib/roles';

export type DashboardWidgetId =
  | 'hero'
  | 'company-health'
  | 'actionable-insights'
  | 'audit-trail'
  | 'workflow-inbox'
  | 'module-map'
  | 'finance-pulse'
  | 'operations-pulse'
  | 'shortcut-stack';

export type DashboardPermission =
  | 'view_dashboard'
  | 'customize_dashboard'
  | 'view_financials'
  | 'view_financials_sensitive'
  | 'view_supply_chain'
  | 'view_audit_trail'
  | 'view_workflow_inbox'
  | 'view_shortcuts'
  | 'view_company_health'
  | 'view_operational_alerts'
  | 'view_department_activity';

export interface DashboardLayoutItem {
  widgetId: DashboardWidgetId;
  x: number;
  y: number;
  w: number;
  h: number;
  isCollapsed: boolean;
  isEnabled: boolean;
}

export interface DashboardBranding {
  logoUrl: string;
  primaryColor: string;
  workspaceName?: string;
  currency: string;
  locale: string;
  timezone: string;
  footerText?: string;
  supportEmail?: string;
}

export interface DashboardTenantContextValue {
  tenantId: number | null;
  tenantName: string;
  tenantCode: string;
  role: AppRole;
  userId: number | null;
  displayName: string;
  permissions: string[];
  activeModuleSlugs: string[];
  branding: DashboardBranding;
  sections: NavSection[];
}

export interface DashboardWidgetComponentProps {
  tenantContext: DashboardTenantContextValue;
  canViewSensitive: boolean;
  customizeMode: boolean;
}

export interface DashboardWidgetDefinition {
  id: DashboardWidgetId;
  title: string;
  description: string;
  category: 'overview' | 'analytics' | 'workflows' | 'operations' | 'compliance';
  requiredPermissions: DashboardPermission[];
  moduleDependencies?: string[];
  defaultLayout: DashboardLayoutItem;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
  component: ComponentType<DashboardWidgetComponentProps>;
}
