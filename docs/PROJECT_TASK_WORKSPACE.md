# Projects and tasks

## Tables and filters

The project Tasks, Milestones, and Documents tabs use the shared listing controls:
search, sorting, page navigation, row numbers, and a rows-per-page selector.
Task filters include task number and title, project, source ticket, lead or additional
assignee, priority, task type, status, due-date range, and progress range.
Completed-task counts cover all matching records, not just the displayed page.

## Project and milestone selection

Every task belongs to a project. Each branch has a protected **General** project
for work that does not need a dedicated project; it is selected by default.
Existing tasks without a project are assigned to their branch's General project.
Ticket-created tasks also use General, and subtasks inherit their parent's project.

Choose a project before choosing an optional milestone. Only milestones from that
project are offered. Editing a task allows permitted users to change its project,
milestone, lead assignee, task type, dates, priority, and other planning details.
Changing the project clears the old milestone unless a valid replacement is selected.
Tasks with parent/subtask or dependency links must have those links resolved before
moving between projects.

Task types are grouped across administration, field operations, technology,
commercial work, and industry-specific work. The catalog includes 53 choices and
**Other**. Existing custom types remain visible when editing older tasks.

The additional-assignee selector keeps remaining eligible team members available
after each addition. Changing a person's role updates their existing participation.

## Task status and follow-ups

Use **Task status** on a task's Overview to change status immediately. The same
choices appear under **Edit task planning** and are saved with the other details:
Draft, To do, In progress, Blocked, Reopened, In review, Completed, and Cancelled.
Status changes are recorded in Activity. Task filters, reports, and the board
include Reopened.

For tasks without an approval requirement, authorized users can mark work Completed
from either status menu; completion sets progress to 100% and records the completion
date. Reopening completed or cancelled work requires the reopen permission, clears
completion details and old approval markers, and restores checklist progress (or zero
when there is no checklist). Reopened is available only for closed work.

When approval applies, use **Send for approval**. Submission puts the task In review,
and a pending approval prevents conflicting status changes until the decision.
Unavailable choices show why they are unavailable. Editing other planning details
while approval is pending remains possible.

Every follow-up belongs to a task. Use one for a dated reminder, such as checking a
supplier response or reviewing progress. Follow-ups appear on the task, the combined
Follow-ups workspace, calendar, and reminders. Completing a follow-up records that
reminder as done; it does not complete or change the status of the underlying task.

## Documents and approvals

**Preview** opens supported documents inside the ERP without starting a download.
PDFs and common images retain their visual presentation. Text files and modern
Word, Excel, and PowerPoint files have content previews; Office formatting can differ.
Large or unsupported files remain available through **Download**. Preview and download
both require the same project/task permissions. Preview processing stays on the server.

The **Approvals** tab appears only when an approval workflow, requirement, pending
approval, or approval history applies. Routine users do not need a workflow setup
tab for everyday task work.

## Database changes

Migrations SL_Projects.0006 through 0008 add the General project marker, backfill
existing branches/tasks, and require a project on tasks. These migrations have been
applied to the local development database after taking a backup. Production updates
must include these migrations through the normal reviewed deployment process.

Migration SL_Projects.0009 adds Reopened to the task status choices.

## Project Configuration

Open **Projects & Tasks → Configuration** from the left menu. Settings belong to the active organization and apply
across its branches. Organization administrators and roles with **Change project
module settings** permission can update them; other readers have a read-only view.

- **Task types:** add organization/industry-specific codes, names, and categories;
  rename or deactivate types; allow or disable **Other (type your own)**. Choosing
  Other reveals a required name field. Saved task types remain on existing tasks.
- **Defaults:** choose the type, priority, Draft/To do initial status, optional due
  date offset, and default related-table page size for new work. Explicit task
  choices override defaults.
- **Statuses:** enable optional task statuses while retaining the core To do,
  In progress, and Completed states. Current statuses on existing tasks remain
  visible. Workflow approvals still apply.
- **Follow-ups:** choose the suggested number of days before a new follow-up.
- **Ticket sync:** configure the existing optional update to a source ticket when
  its linked task completes. This section has its own Save ticket sync button.

Use **Save project settings** to persist the catalog/default/status/follow-up
changes together. The server rejects stale saves if another administrator has
updated a saved settings version.

The project Team table and task Deliverables, Activity, Follow-ups, Discussion,
Files, Subtasks, and Dependencies tables all have independent search, sort,
pagination, row numbers, and rows-per-page controls. Their APIs page records on
the server. Completing deliverables continues to calculate progress across the
entire checklist, and document preview/download remain available on task files.

Migrations SL_Projects.0010 and 0011 create the organization settings table and
register the Settings menu item. They have been applied locally only.

## Task deactivation and saved assignments

Tasks are retained instead of deleted. Use **Deactivate task** to remove work from
normal task registers, boards, dashboards, calendars, and reminders while preserving
its saved assignee, status, files, comments, follow-ups, and relationships. Task and
project progress calculations exclude inactive work. Inactive tasks remain readable
and their history can still be browsed or previewed; reactivate before making changes.

To find a task again, open the task filters and set **Task activity → Inactive tasks**
or **All tasks**. Open its record and choose **Reactivate task**. Reactivation restores
the existing assignment and status. Finish pending approvals before deactivating.

The **Deactivate and reactivate project tasks** permission controls both actions.
Migrations SL_Projects.0012 and 0013 add activity/audit fields and grant this capability
to existing roles/users that previously had Delete project tasks. Task DELETE requests
are rejected; Django admin also disallows task deletion. The sample-data action in the
ERP now deactivates sample tasks and preserves records.

The separate **Assign team role** dialog has been removed. Existing role-based
visibility is retained for records that already use it. Assign named people through
**Lead assignee** or the additional-assignee controls. The lead dropdown loads the saved
person, stays synchronized with task editing, and retains the person on refresh. A
saved person remains visible even if they are no longer an eligible new assignee.
Choose **Unassigned** explicitly to clear an assignment; saving an empty selection
cannot clear the saved person.

Migration SL_Projects.0015 labels the module-menu entry Configuration.
Configuration is available through the left menu;
project and task screens do not contain configuration shortcuts.

## Task activity presentation

Open **Activity & follow-ups**, then choose **Deliverables**, **Activity log**, or
**Follow-ups**. Each list uses the full content width with independent search, sort,
row numbers, page navigation, and rows-per-page controls. On phones, records use
labelled cards and the page controls wrap to fit.

Use **Add deliverable**, **Add update**, or **Schedule follow-up** to open a labelled
pop-up. Updates include optional hours worked; follow-ups include a date and optional
notes. Saves refresh the relevant list; errors retain entered values for correction.
The task progress bar still derives from completed deliverables, and completing a
follow-up still leaves the task status unchanged. Inactive tasks remain read-only.

## Project team register

The left-menu entry formerly called Team Tasks is now **Project team**. It lists
the project/team tasks permitted by the active organization, branch, and role,
including person-assigned tasks and unassigned drafts. It no longer requires the
legacy task role-assignment field. Existing visibility permissions still apply.

After creating a record, search and list filters reset, the register returns to
page one, and newest records appear first. A project link in the address is aligned
with the project selected for the new task. The success message includes the saved
task number and title. Migration SL_Projects.0016 updates the existing menu label.

## Action permissions

Task and project detail responses now include active-workspace action rights. Planning, status changes, assignment, progress, follow-ups, comments, uploads, milestone changes and team actions use those rights in the UI and enforce them again in the API. Cached detail records include organization, branch and active role so switching workspaces cannot retain another role's controls.

Creating a task with an assignee requires `assign_projecttask` in addition to task creation. Project manager/owner assignment requires `assign_project_manager`, including changes through team membership. Subtask creation requires both task creation and task editing. Milestone add/change/delete permissions are separate from editing the project itself.

Task DELETE remains unavailable. Deactivation/reactivation specifically requires `deactivate_projecttask`; a delete permission alone does not grant it. Draft projects can be deleted only with delete permission and without linked tasks, milestones, documents, tickets or approval history. Otherwise use the authorized project lifecycle action to archive the record. The reserved General project cannot be deleted or closed. Progress and actual hours are derived through their dedicated task operations rather than direct planning edits.

## Named task participants

The lead assignee, additional accountable assignees and supporting participants can update work details, change status, record activity/hours, add or complete deliverables, discuss the task, upload evidence and manage its follow-ups. These are rights on their assigned task; they do not add global role permissions. Existing module, organization, branch and task-visibility boundaries remain in force.

Named participants can complete and reopen their assigned work where the configured statuses and workflow permit it. When approval is required, they can use Send for approval without being granted global workflow-forwarding rights. Pending/deferred reviews and disabled statuses still block invalid transitions, and assignment never grants approval authority.

Reassignment, transfers to another project, deactivation, subtask creation and file deletion retain their role permissions. Basic participants see the current project as read-only. Removing the lead assignment or a collaborator record removes these task-specific work rights. A legacy team-role assignment or project membership alone does not grant them. Inactive tasks remain read-only.
