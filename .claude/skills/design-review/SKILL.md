---
name: design-review
description: Run the design review panel on a mock-up, a flow, or screenshots of built pages before it is built or before it ships. Product team roles and an independent usability consultant review the work cold and report problems by severity, then the owner decides what to do about each one. Use whenever a design is ready for review (mock-ups before building, screenshots before a PR goes out), when the user asks for a "design review", "panel review", "light check", or "consultant review", or when they ask whether a design is good.
---

# Design review panel

Every design goes through this panel twice:
1. **Mock-ups, before building.** Problems are cheap to fix here.
2. **Screenshots of the built pages, before the PR goes out.** This catches drift from the
   mock-ups.

A finding rated **3 or 4 ("blocks people")** stops the build or the PR until the owner decides
what to do about it. The owner decided this and will revisit how it's going.

Reference files in this folder:
- `people.md`: the six people every design is checked against.
- `roles.md`: the briefs for the seven team roles and the consultant.
- `standards.md`: accessibility, content, and flow checks, plus where each comes from.
- `routing.md`: which roles review which kind of change (full panel or light check).
- `report-template.md`: the report layout.

Decisions are logged in `docs/design-decisions/` (see its README).

## 0. Kickoff, before anything is drawn (new features)

The owner decided (2026-11-20) that new features start with a kickoff, to shorten the review loops: most mock-up
findings were things the panel could have warned about up front.

- Give the whole panel (all seven roles plus the consultant) the idea as the owner heard it (a paraphrase, no private
  names or details), `docs/PROJECT-CONTEXT.md`, and the code to read. Unlike a review, a kickoff **may** read
  `docs/design-lessons.md`: the point is to bring what we've learned forward.
- Each role answers in its own area: **risks**, **guiding principles**, **must-haves** (v1 or later), **what already
  exists to reuse**, and **questions only the owner can answer** (with a recommendation).
- Combine the answers into one short brief in `docs/design-briefs/YYYY-MM-DD-<slug>.md`. Bring the owner's questions
  in one round, and log the answers in `docs/design-decisions/`.
- Mock-ups are then built to the brief, covering every must-have and state from the start, and the first review checks
  the screens against the brief. Keep raw transcripts and private notes out of the repo.

## 1. Pick the size

Read `routing.md` and match the change to a row. State the size and the reviewers in one line
before starting, for example: "Light check: wording only. Content Manager + Marketing Manager."

- **Full panel** is the default for new features, new flows, new pages, and anything that changes
  what people do.
- **Light check** is for small tweaks. It uses only the roles that row names.
- If you aren't sure, use the full panel.
- A light check moves up to a full panel if any reviewer rates a finding 3 or higher, or if the
  change turns out to touch more than one page's flow.

## 2. Gather the material

Reviewers see the work, not our reasons for it.

- **Mock-ups:** export each artboard or board as an image, or give the reviewer the published
  page to read. Cover every state that matters (empty, editing, saved, error, full, event day,
  over). Use the "Every state" boards on the design canvas when they exist.
- **Light and dark, every time.** Every review covers both modes, for mock-ups and built pages
  alike, at full panel and light check. If a mock-up only exists in one mode, make the other
  before reviewing, or list it as a finding.
- **Three widths, every time.** Mock-ups and built pages are reviewed at **phone (390 px)**,
  **tablet (820 px, portrait iPad)**, and **desktop (1440 px)**. Front desks and teachers often
  use tablets, and tablet is where layouts most often break.
- **Built pages:** take screenshots of every screen at all three widths, each in **light and
  dark** (six shots per screen). Use the scratchpad mock server or demo data, never real people's data. Save
  them in `docs/design-reviews/YYYY-MM-DD-<slug>/`.
- **The brief:** what it's for and who uses it, in two or three plain sentences: the job, not the
  design choices. If the PM and PO brief exists (step 0 of a full panel), use that.

Write down what is **not** being reviewed (out of scope), so reviewers don't wander.

## 2b. Self-check against the lessons

Before any reviewer sees the work, go through the self-check at the end of
`docs/design-lessons.md` for every screen, in light and dark, at phone and desktop. Fix what fails
first. The panel's time is for new problems, not ones we've already learned.

## 3. Review cold, in parallel

Run each reviewer as its **own subagent, in parallel**, using the Agent tool. Give each one only:
- its brief from `roles.md` (copy the role's section in full),
- `people.md`,
- the relevant parts of `standards.md`,
- the material and the brief from step 2,
- the report format for findings (below).

**Never give a reviewer** `docs/design-lessons.md`, the chat history, our design rationale, earlier review findings, or
the other reviewers' output. A reviewer that knows why we chose something tends to agree with it.
That is the whole point of this panel. Each brief's "Do not read" list names `docs/design-lessons.md`,
`docs/design-reviews/*.md`, `docs/design-decisions/`, and earlier screenshot folders.

**What to photograph.** Every screen gets six shots: phone, tablet, and desktop, each in light and
dark.
- **Full coverage** (every screen) for the first full-panel review of a design and for the final
  screenshots before a PR.
- **Follow-up light checks** photograph only the screens that changed, plus one unchanged
  neighbor for each so reviewers can compare. List the changed screens in the brief. Keep the
  earlier screenshot folder for reference, but don't ask reviewers to reopen it.

**Coverage.** The UI Designer and the consultant open every screenshot in the set (every screen,
width, and mode). Every other reviewer opens at least each screen at phone and desktop in light,
plus one dark shot per screen. Each reviewer ends with the list of screenshots it opened. If a
required screenshot is missing from a reviewer's list, say so in the report.

Every finding needs:
- **Where:** the screen, state, and element (and file:line for built pages, when known)
- **What happens,** described concretely
- **Who it hurts:** one or more of the six people, and how
- **Standard:** the heuristic, WCAG criterion, or brand-voice rule it breaks, if any
- **Severity 0–4:** 0 not a problem, 1 cosmetic, 2 minor, 3 major (blocks people), 4 catastrophe
  (blocks people)
- **Suggested fix:** specific enough to build

Each reviewer also lists **what's working well**, so good patterns don't get "fixed" away.

## 4. Consolidate

- Merge duplicates, and note how many reviewers found each one (for example 3 of 8).
- Keep single-reviewer findings, since those are often the most valuable.
- Where reviewers disagree, show both views and give a one-line recommendation.
- Severity is the highest any reviewer gave, unless the consultant gave a different rating with a
  reason. In that case, show both.
- Sort by severity, then by how many of the six people it hurts.

## 5. Report

Write the report with `report-template.md` to `docs/design-reviews/YYYY-MM-DD-<slug>.md`.
Writing rules:
- Plain words for a non-technical owner. File paths go only in "Where" lines.
- Follow `docs/brand-voice.md` (no exclamation points, Oxford comma).
- Lead with what blocks people.
- Be honest that this is an AI review, not testing with real people. For anything rated 3 or 4,
  suggest a quick check with two or three real people.

For a full panel, publish the report as a shareable page as well, and give the owner the link.

## 6. The owner decides

Every finding rated 2 or higher gets one of these decisions from the owner:
- **Take the advice:** do the suggested fix.
- **Fix it differently:** the owner and Claude work out another fix, and the log notes what it is.
- **Keep as is:** with a written reason.

Add a decision log entry in `docs/design-decisions/` (see its README). Findings rated 3 or 4
can't be built or shipped until they have a decision. Don't make these decisions for the owner.

After fixes, run a **light check** on just the changed parts, using the roles that raised the
findings.

## 7. Update the lessons

After the owner decides, open `docs/design-lessons.md`:
- A finding that matches a lesson: add this review to its "Seen in". If the lesson was already
  there and still got dinged, sharpen its rule, or add an automatic check to
  `scripts/design-lint.mjs` when a computer can catch it.
- A finding seen for the second time (in this review and an earlier one): add a new lesson, with
  the rule, why, and where it was seen.
- Commit the lessons with the review report.

## What this panel is not

- It doesn't replace real people. Before big launches, have two or three real people from the
  six groups try the flow.
- It doesn't change code. Fixing is a separate step, after the owner decides.
