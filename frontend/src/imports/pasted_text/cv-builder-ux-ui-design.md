Design a complete desktop-first, mobile-responsive web app UX/UI for a product called CV Builder.

This is a premium, minimal, AI-powered CV builder focused on job-specific CV customization, not a generic resume editor.

The product should help users:

create or upload a base CV
improve it with AI
tailor it for a specific job
manually edit any section
use contextual AI on selected text blocks
review before/after suggestions
manage multiple tailored CVs
track applied jobs
export polished CVs

The overall feel should be:

minimal
professional
premium modern SaaS
productivity-focused
organized, calm, efficient
trustworthy and not gimmicky

Do not design the experience like a chatbot product.
Do not make AI feel autonomous.
Do not make it overly playful.
Do not overload the UI with unnecessary settings or analytics.

1. Product Concept

The main product value is:

Users create or upload a Master CV, then customize that CV for a specific job using AI-supported structured flows and contextual editing.

The UX should feel like a hybrid of guided flow + document editing:

creation flow is guided
tailoring flow is guided
editing flow is direct and productivity-focused
preview is always visible on desktop
AI appears contextually, not as one giant assistant
2. Core UX Principles

Design all screens around these principles:

A. Trust and control
AI only suggests changes
all AI edits must be reviewable
show before/after comparisons
ask for approval before applying AI changes
user can always manually edit
AI-generated changes must feel reversible
B. Productivity and speed
keep flows fast
prefer buttons, checkboxes, segmented controls, chips, and structured prompts over chat
reduce typing when possible
keep hierarchy clear and screens efficient
C. Job-focused customization
the product should constantly reinforce that the value is tailoring a CV for a real job
show job title, company, and role context clearly
emphasize keyword and recruiter-fit improvements
present AI as helping the user align their real experience with a target role
D. ATS-safe but visually premium
layouts should look polished and modern
the actual CV output should remain clean and export-friendly
UI can be premium SaaS, but CV preview itself should stay professional and readable
3. Design System Direction

Use the provided design system as the visual foundation.

Brand / style direction
premium modern SaaS
minimal and professional
polished career tool
teal-driven identity
neutral slate foundation
crisp spacing
subtle borders
light backgrounds
restrained shadows
Color direction

Use the provided palette:

Primary teal: strong emphasis on #0F6E56
Action teal: #1D9E75
Light mint backgrounds: #E1F5EE
Dark neutrals: slate/gray tones
Semantic colors for success, warning, error, info

The UI should mostly use:

white / soft neutral surfaces
teal for emphasis, selected states, active navigation, primary actions
avoid oversaturating the interface
Typography
Use Inter for UI
CV preview can use a more editorial serif like Georgia if needed for preview styling
Maintain strong readability
hierarchy should feel efficient and premium, not oversized

Suggested type scale:

Display: 28/500
H1: 22/500
H2: 18/500
H3: 15/500
Body: 14/400
Small: 12/400
Label: 11/500 uppercase
Spacing

Use a 4px base system:

4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48
Radius
inputs and compact surfaces: 8px
cards: 12px
larger containers: 16px
pills/badges: 99px
Components

Use consistent patterns for:

sidebar navigation
cards
form fields
badges
top bars
preview containers
AI suggestion popups
keyword chips
step indicators
kanban cards
tables
diff comparison blocks
4. Primary Screens to Design

Create high-fidelity Figma designs for the full MVP experience.

Required screens
Landing page
Sign up / sign in
Dashboard
Create / Upload CV entry screen
Guided CV creation flow
Master CV editor
Job tailoring entry screen
Structured AI question flow
Tailored CV editor
Export flow
Pricing / premium upsell page
Profile / account page
Job tracker page
Cover letters section placeholder
Mobile-responsive versions of key flows
5. App Navigation Structure

Left sidebar navigation:

Logo at top left
Resumes
Cover Letters
Job Tracker
Pricing
Profile

Use a premium SaaS sidebar with:

compact icons
active state using light mint/teal surface
subtle hover states
section spacing
workspace feeling, not consumer app feeling

Top bar on editor screens should include:

CV name
CV type (Master / Tailored)
job context if tailored
save state
export button
template selector
maybe score badge
user avatar/menu
6. Landing Page

Design a modern SaaS landing page that clearly communicates the product promise:

Create your CV once. Tailor it for every job.

The landing page should feel premium and conversion-focused.

Landing page sections
Hero
How it works
Why tailored CVs matter
AI-assisted editing section
Preview of product UI
Premium benefits
CTA section
Footer
Hero section

Headline ideas:

“Build one CV. Tailor it for every job.”
“Create job-specific resumes with AI, without losing control.”

Subheadline:

Explain that users can upload or create a CV, customize it for a job, and export polished ATS-friendly versions.

Primary CTA:

Create your CV
Secondary CTA:
See how it works

Visual:

show product UI mockup with editor + preview + job tailoring interaction
emphasize side-by-side experience

Tone:

modern, trustworthy, conversion-ready
minimal copy, visually clean
7. Create / Upload CV Entry Screen

This is the first in-app step.

The user should immediately see a Create CV or Upload CV choice.

Layout

Two-column layout:

left side: explanation / benefits / what happens next
right side: primary action cards
Right side actions
Create a CV
Upload existing CV

Use large cards with icon + title + short copy.

Left side copy area

Explain the flow in 3 simple steps:

Build or upload your base CV
Customize it for a specific job
Export and apply

This screen should feel fast and reassuring.

8. Guided CV Creation Flow

The create flow should feel guided and structured.

Start with necessary information first, then optional sections.

UX pattern
multi-step guided flow
progress indicator at top
left side: form/questions
right side: live CV preview
desktop preview always visible
mobile preview accessible with bottom-left preview button
Suggested steps
Basics
full name
job title
contact details
location
links
Summary
short professional summary
AI assist button
Experience
company
role
dates
bullets
add another
Education
Skills
Optional sections
certificates
projects
languages
awards
volunteer experience
Interaction style
structured fields
clear section cards
inline add/remove controls
AI assistance where relevant
preview updates live
9. Job Tailoring Entry Screen

After creating the CV, move the user into a job customization entry screen.

Title should feel onboarding-like, for example:

Apply to your first job with us

Layout

Two columns:

left: instructions / explanation
right: input panel
Right panel inputs
Role
Company name
Job description textarea

Use a polished card layout.

Left panel content

Explain:

AI will analyze the job
identify the important topics
surface relevant keywords
help tailor the CV based on the user’s real experience

This should not feel like a chat interface.
It should feel guided and structured.

10. Structured AI Tailoring Flow

This should be a one-question-at-a-time wizard.

Avoid chat UI.
Use:

step cards
checkbox lists
quick decision controls
clear forward/back actions
Flow behavior

After the user submits the job description:

AI identifies topics recruiters may care about
show topic suggestions
show relevant keywords as checkbox chips/lists
ask whether user wants these keywords reflected in the CV
continue with short structured follow-ups when needed
Examples
“This role appears to emphasize data analysis, stakeholder communication, and SQL.”
“Which of these should be reflected more strongly in your CV?”
checkbox list of topics
checkbox list of keywords
optional follow-up when needed

Skipped questions should feel neutral.
If skipped, the system continues and does its best.

UI recommendations
single centered card or split layout with progress sidebar
one question per step
quick selection states
primary CTA: Continue
secondary CTA: Skip
tertiary CTA: Back

No need to show “why this question is being asked.”

11. Master CV Editor

This is one of the most important screens.

Layout

Desktop:

left side: editing panel
right side: live CV preview
preview always visible
top utility bar across screen

Suggested widths:

left editing area: 55–60%
right preview area: 40–45%
Top bar

Include:

CV title
CV type badge: Master CV
template selector
autosave state
export button
button to create tailored version / use for a job
maybe last edited info
Left editing area

The editing experience should feel like:

structured sections
section cards
inline editable blocks
compact and productive
organized, not overly airy

Editable sections:

header/contact
summary
experience
education
skills
projects
certifications
optional custom sections

Each section should have:

title
reorder handle
edit controls
AI assist trigger
add/remove block controls where relevant
Right preview
polished CV preview inside document frame
shows selected template styling
sticky while scrolling
page-like layout
zoom controls optional
high-trust, export-like presentation
12. Tailored CV Editor

This is similar to the Master CV editor but with job context and AI changes visible.

Differences from Master editor
CV type badge: Tailored CV
show linked job title + company
show optional match score improvement indicator
show AI-applied suggestions awaiting approval if any
button to switch to current CV context from editor
maintain connection to source Master CV
Key UI additions
badge: “Tailored for [Role] at [Company]”
compact insights panel near top:
selected keywords
highlighted focus areas
maybe improvement summary
13. Contextual AI Editing Interaction

When the user selects text in the editing area, show a small floating popup on the left side of the selected text.

This popup should feel lightweight and highly usable.

Popup actions

Main categories:

Improve writing
Make shorter
Suggest content
Suggest content flow

If user clicks “Suggest content”:

ask: “Which topics do you want to focus on in this section?”
checkbox list
ask: “Which keywords do you want me to use in this section?”
suggested keyword chips/list
AI rewrites the section
show before/after comparison
ask for approval
Popup behavior
compact floating panel
subtle shadow
teal accents
anchored visually to selection
dismissible
keyboard-friendly

Do not design this as a full-screen modal on desktop unless needed for complex rewriting.

14. Before / After Comparison UI

AI suggestions should be shown mostly as before/after comparisons.

Comparison component

For each AI suggestion, show:

Before block
After block
clear textual difference
accept / reject buttons
optional “try another version”

Should feel compact and professional, not noisy.

Can be shown:

in the floating popup
in an inline card below the edited section
or in a small side sheet if needed
15. Version History UX

Each AI edit creates a new version.
If the user manually edits the section and then uses AI again, keep the human-edited state as a version too.

Version UI

Use small arrows with text like:

2 / 5

This should appear near the relevant block only when that block has multiple versions.

Interaction
previous / next arrow buttons
current version count
optionally label source:
Original
AI v1
Manual edit
AI v2

Keep it compact.
Do not turn versioning into a heavy timeline UI.

16. Dashboard

Design a strong dashboard with three main content zones:

A. Main CV card

At the top:

one prominent card for the Main CV
show preview thumbnail
CV title
last updated
actions:
Edit
Tailor for a job
Export

This card should feel like the user’s primary workspace asset.

B. Job tracker kanban

Show applied jobs directly linked to tailored CVs.

Columns may include:

Saved
Applied
Interview
Offer
Rejected

Each card should show:

job title
company
linked tailored CV
status badge
date
maybe score badge

This should feel compact and practical, not too Trello-like.

C. Table for tailored CVs / jobs

Below the kanban, include a clean table.

Columns:

Role
Company
Based on
Match score
Status
Last edited
Export
Actions

Support:

sort
filter
search
row actions
17. Job Tracker Page

Design a dedicated Job Tracker page.

Layout
page title
top filters
kanban area
secondary table/list view option

Each job card should show:

title
company
status
linked CV
quick actions

Possible quick actions:

open tailored CV
update status
export
duplicate CV
18. Resumes Page

Design a page for browsing all resume assets.

Sections:

Master CV
Tailored CVs

Since the dashboard already emphasizes one main CV, this page can be more management-focused.

Possible layout:

top filter row
cards or rows for CVs
relation between Master CV and tailored CVs should be obvious
use nested grouping or parent-child metadata
19. Cover Letters Page

This can be a placeholder or simple management screen for now.

Since it is not the current core value, keep it lightweight.
Possible states:

empty state
“Generate from tailored CV” placeholder
premium badge if needed

Do not overbuild this part.

20. Export Flow

Export should be triggered mainly from the editor top bar.

Export experience

Keep it minimal and premium.

When user clicks Export:

open a compact premium export modal or drawer
show selected template
allow format choice:
PDF
DOCX
optionally show web CV as future / premium
show premium-related value messaging subtly
Template selection

Template/style selection should happen:

at the beginning
during editing
and still be adjustable from export

Use a lightweight template selector, not an overwhelming gallery.

Premium surfacing

Premium messaging should emphasize:

more tailored CVs
better customization
maybe additional export options
not generic upsell spam

The export area should feel like a moment that can gently drive users toward premium.

21. Pricing Page

Design a premium SaaS pricing page aligned with the landing page and in-app upsell patterns.

Focus messaging on:

job-specific CV customization
multiple tailored CV versions
better export freedom
premium workflow benefits

Use:

clean pricing cards
one recommended plan
comparison bullets
FAQ block
22. Profile / Account Page

Simple account page with:

profile info
language preference
plan status
billing shortcut
export preferences
maybe CV defaults

Keep it clean and secondary.

23. Mobile Experience

Mobile should support the same features as desktop, but with adapted layout behavior.

Mobile principles
stack content vertically
preserve all core functions
preview not always visible
while editing, show a preview button at the bottom left
preview opens as overlay, sheet, or screen toggle
maintain contextual AI editing in a mobile-appropriate way
Mobile screens to design
dashboard
create/upload entry
guided CV creation
tailoring question flow
editor
export modal
job tracker
Mobile editor
editing fills the main screen
preview accessible via persistent bottom-left button
top bar simplified
AI popup can become a bottom sheet if needed
maintain before/after approval patterns
24. Empty States

Design thoughtful empty states for:

no CV yet
no tailored CVs
no tracked jobs
no cover letters
first export locked by premium
no keywords selected
no experience section added yet

Tone:

motivating
professional
concise
25. Key Components to Design in Figma

Create reusable components and variants for:

sidebar item
top bar
stat card
CV asset card
job card
kanban column
data table row
status badges
chips / checkbox chips
step progress component
template selector tile
floating AI popup
before/after comparison card
version navigator 2/5
inline section editor card
preview container
export modal
premium upsell strip
empty state blocks
mobile bottom preview button
26. Important Interaction Notes

Please reflect these interaction behaviors visually:

autosave indicator in editor
hover states for editable blocks
selected-text AI trigger
AI loading state that feels smart but not dramatic
approved change confirmation
reject / undo option
subtle score improvement animation if match score is shown
sticky preview on desktop
sticky utility bar in editor
smooth wizard progress through tailoring questions
27. What to Simplify for MVP

Keep these simple:

one strong template or a very small template set
no complicated analytics
no deep AI reasoning explanations
no heavy onboarding
no massive customization settings
no complicated version management UI
no chat-heavy interactions
no job board-like experience
28. Deliverables Expected from Figma

Produce:

desktop high-fidelity screens
mobile responsive screens
reusable component library
design tokens aligned to the provided system
interaction notes / prototype flows
key states for AI suggestion approval, versioning, export, and empty states
29. Final Visual Tone Summary

The finished product should look like:

a premium, organized, AI-assisted career tool for serious job seekers

It should feel:

calm but efficient
modern but trustworthy
minimal but capable
premium but not flashy
productivity-focused but not dense or stressful

It should clearly communicate that the special value is:

tailoring a CV for a specific job with AI, while keeping the user fully in control