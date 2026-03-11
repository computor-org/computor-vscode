import { ErrorSeverity } from './types';

export type ClientErrorCategory = 'git' | 'workspace' | 'network' | 'configuration';

export interface ClientErrorAction {
  id: string;
  label: string;
  tooltip?: string;
  style: 'primary' | 'secondary' | 'danger';
}

export interface ClientErrorDefinition {
  code: string;
  category: ClientErrorCategory;
  severity: ErrorSeverity;
  title: string;
  summary: string;
  description: string;
  actions: ClientErrorAction[];
}

export interface ClientErrorCatalogData {
  version: string;
  errors: Record<string, ClientErrorDefinition>;
}
