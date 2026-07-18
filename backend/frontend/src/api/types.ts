export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  status_code: number;
  data: T;
};

export type SummaryCard = {
  label: string;
  value: string | number;
};

export type StatusTone = "default" | "good" | "warn";

export type StatusBadge = {
  label: string;
  value: string;
  tone?: StatusTone;
};

export type QueryScope = {
  tenantCode: string;
  branchId: string;
  vehicleId: string;
};

export type QueryParamValue = string | number | boolean | undefined;

export type EndpointDescriptor = {
  key: string;
  title: string;
  description: string;
  path: string;
  cards: (payload: any) => SummaryCard[];
  params?: (scope: QueryScope) => Record<string, QueryParamValue>;
  isEnabled?: (scope: QueryScope) => boolean;
  disabledMessage?: string;
};
