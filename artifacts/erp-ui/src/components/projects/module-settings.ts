import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/use-auth";
import { apiErrorFromResponse } from "@/lib/api-errors";
export type ConfiguredTaskType = {
  value: string;
  label: string;
  category: string;
  is_active: boolean;
};
export type ProjectSettings = {
  task_types: ConfiguredTaskType[];
  allow_custom_task_types: boolean;
  default_task_type: string;
  default_priority: string;
  default_task_status: string;
  enabled_task_statuses: string[];
  default_due_days: number | null;
  default_follow_up_days: number;
  default_page_size: number;
  can_manage: boolean;
  updated_at: string | null;
};
export function useProjectSettings() {
  const { token, user } = useAuth();
  return useQuery<ProjectSettings>({
    queryKey: [
      "project-settings",
      token,
      user?.organization_id,
      user?.branch_id,
      user?.active_role_group_name,
    ],
    enabled: !!token,
    staleTime: 60000,
    queryFn: async () => {
      const response = await fetch("/api/projects/settings/", {
        headers: { Authorization: `Token ${token}` },
      });
      if (!response.ok)
        throw await apiErrorFromResponse(
          response,
          "Project settings could not be loaded.",
        );
      return response.json();
    },
  });
}
export function dateAfterDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
