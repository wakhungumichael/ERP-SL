export type IntakeField = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "tel" | "textarea" | "select";
  required?: boolean;
  options?: string[];
};
export type IntakeForm = {
  id: number;
  name: string;
  schema: { fields?: IntakeField[] };
  is_default?: boolean;
};
export const CORE_TICKET_FIELDS: IntakeField[] = [
  { key: "requester_name", label: "Requester name", type: "text" },
  {
    key: "requester_email",
    label: "Requester email",
    type: "email",
    required: true,
  },
  { key: "requester_phone", label: "Requester phone", type: "phone" },
  { key: "project_name", label: "Project name", type: "text" },
  {
    key: "priority",
    label: "Priority",
    type: "select",
    options: ["low", "normal", "high", "urgent"],
  },
  { key: "category", label: "Category", type: "text" },
  { key: "subject", label: "Subject", type: "text", required: true },
  {
    key: "description",
    label: "Description",
    type: "textarea",
    required: true,
  },
];
export const CORE_TICKET_KEYS = new Set(
  CORE_TICKET_FIELDS.map((field) => field.key),
);
export function ticketIntakeFields(form?: IntakeForm): IntakeField[] {
  const source = form?.schema.fields?.length
    ? form.schema.fields
    : CORE_TICKET_FIELDS;
  const fields = source.map((field) => ({
    ...field,
    required:
      ["requester_email", "subject", "description"].includes(field.key) ||
      !!field.required,
  }));
  for (const key of [
    "requester_email",
    "project_name",
    "subject",
    "description",
  ]) {
    if (!fields.some((field) => field.key === key))
      fields.push({
        ...CORE_TICKET_FIELDS.find((field) => field.key === key)!,
        required: ["requester_email", "subject", "description"].includes(key),
      });
  }
  return fields;
}
