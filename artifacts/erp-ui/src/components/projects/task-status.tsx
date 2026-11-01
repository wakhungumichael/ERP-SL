import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type TaskStatusOption = {
  value: string;
  label: string;
  disabled?: boolean;
  reason?: string;
};
export const TASK_STATUSES = [
  ["draft", "Draft"],
  ["todo", "To do"],
  ["in_progress", "In progress"],
  ["blocked", "Blocked"],
  ["reopened", "Reopened"],
  ["in_review", "In review"],
  ["completed", "Completed"],
  ["cancelled", "Cancelled"],
].map(([value, label]) => ({ value, label }));

export function TaskStatusSelect({
  id,
  value,
  options,
  onChange,
  disabled,
}: {
  id: string;
  value: string;
  options: TaskStatusOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={onChange}
      disabled={
        disabled ||
        options.every((option) => option.disabled || option.value === value)
      }
    >
      <SelectTrigger id={id} aria-label="Task status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            title={option.reason}
          >
            <span>{option.label}</span>
            {option.disabled && option.value !== value && option.reason && (
              <span className="mt-0.5 block max-w-64 whitespace-normal text-xs text-muted-foreground">
                {option.reason}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
