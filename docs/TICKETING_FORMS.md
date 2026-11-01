# Ticket creation and website intake

## Signed-in ticket creation

Open **Ticketing → Support Tickets → New Ticket**. Enter the requester's contact details,
subject, description, and any questions configured for the selected intake form.
The default intake form is selected when one exists; **General ticket** uses the
standard fields. A successful save opens the new ticket and resets queue filters
so the ticket is visible even if routing changes its status or assignee.

Creation requires **SL_Ticketing.add_ticket** in the active role. Organization
administrators and legacy tenant administrators retain administrator access.
A platform administrator must select an organization first. Failed submissions
retain entered values; the server validates required answers and choices.

## Configure a form

Open **Ticketing → Forms & Intake Flow**. Create or edit a form, set its public/internal
visibility, configure question labels, types, dropdown options, and required flags.
Email, subject, and description remain required. Project name remains available and
can be optional or required. Custom questions are stored with the ticket.

Use **Branch for new projects** to choose where automatic projects are created.
Automatic branch selection uses the signed-in user's branch for an internal request,
then the first active organization branch. Public requests use the form's configured
branch, or the first active branch. If the organization has no branches yet, Main
is created. If existing branches are all inactive, an administrator must enable one.

View, add, change, and delete form permissions are checked against the active role.

## Share a link or embed on a website

In the form register choose **Share & Embed**:

- **Copy link** gives a standalone, responsive public form URL.
- **Copy iframe** gives an iframe snippet for the website's HTML or embed block.
- **Preview form** opens the same public form inside the ERP.

Only public forms accept anonymous visitors; internal or inactive-organization forms
are unavailable publicly. No API key or staff sign-in is embedded in the page.
The public endpoint is scoped by organization and form, validates configured fields,
and rate-limits submissions.

Before embedding on another website, add that website's full origin under
**Ticketing Setup → Allowed domains**, for example https://www.example.com.
The response's Content-Security-Policy permits framing only from the ERP itself and
configured website origins. The shipped nginx examples already proxy this API route;
any additional reverse-proxy frame restrictions must permit this public-form route.

Use the generated HTTPS URL from the live ERP when integrating a live website.
A localhost URL is only reachable on the development machine. Copying a link does
not deploy the local changes or publish a website.

## Match or create projects

Requester-entered project names are compared within the same organization using
Unicode normalization, case-insensitive matching, and collapsed whitespace. An exact
project code can also be entered. Existing active/draft/planned/on-hold projects are
reused; completed, cancelled, or archived projects are not selected for new intake.

An unmatched name automatically creates a **draft project** with a generated PRJ code
in the chosen branch. Repeated names reuse that project. If several existing projects
share a name, the requester must enter a project code; the system does not choose one
arbitrarily. Previously entered legacy project-name answers are retained and reused
for canonical spelling. Public responses expose the ticket reference, not a project
list or internal project IDs.

Tasks created from a linked ticket use the same project. Switch to the linked
project's branch, or add the current branch to that project, before creating a task
if the project is outside the current branch.

## Local database changes

SL_Ticketing migrations 0003 through 0005 add the ticket/project reference, form project
branch, and legacy project-name backfill. They have been applied locally. Production
must receive them through the normal reviewed update flow; no deployment was performed.

## Ticket workspace

Open a ticket in **Support Tickets** to view its request and requester details.
The popup uses a wide two-column layout on desktop and stacks on smaller screens.
**Conversation**, **Linked tasks**, and **Activity** have separate tabs. Reply channel
and message fields are in Conversation; ticket status and Create task are in Ticket
details. The header and Done button stay visible while the content scrolls.
