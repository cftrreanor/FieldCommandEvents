# Design review: Meetings in steps, follow-up light check

| | |
|---|---|
| **What was reviewed** | The stepped Meeting setup and booking screens after the panel's fixes (18 screens) |
| **Stage** | Built pages, before the PR |
| **Size** | Light check: UX Designer, UI Designer, UX Content Manager, Software Engineer, usability consultant |
| **Date** | 2026-11-08 |
| **Screenshots** | `docs/design-reviews/2026-11-08-meetings-steps-v2/` (108) |

## The consultant's verdict

**Fix first.** Most of it is ready: the steps save themselves, the tracker is clear, the privacy wording is
exact, and booking, cancel, and print are calm. The one place that isn't ready is cutting hours after people
book: on phones the save bar draws "Undo changes" over "Review"; two checkboxes look alike but one is an
option and one a required "I understand"; and by default it emails 3 people a link to 1 open time. **The
change that would help most:** one clear choice whose Save button says what happens, and a phone layout
for the bar.

## Blocks people (severity 3)

1. **Cutting hours after people book** (5 of 5): the phone save bar overlaps; two look-alike checkboxes;
   emails by default with too few open times; the copy says "no one is emailed unless you choose" while
   the box is ticked; people already outside are emailed again on later saves; the email doesn't say what
   happens if they do nothing.
2. **Bugs** (Software Engineer): moving the day and cutting hours in one save sends two contradicting
   emails; the summary hides phone numbers on the day itself (and for weekly hours after the first meeting);
   an unpublished event with bookings gets stuck in the steps.

## Should fix (severity 2)

A failed "pick a new time" email isn't reported, and it counts bookings, not people; the weekly copy's
dates can be past; Where you'll meet only saves partly when video is ticked; phone tabs still run off;
dark-mode radio buttons look filled; Reschedule and Cancel are small on phones; the booked page leads with
the event's hours, not your time; Meeting setup has two ways to save; breaks are only in the optional step;
the hint under Book leaves out how you'll meet; the full page doesn't help people who already booked;
"Who sees your details" doesn't say who; one page has several names ("public page", "booking page",
"Preview page"); missing tests for the contact email.

## Polish (severity 1)

"Now · ready"; "Each meeting" (meeting length); periods on fragments; "CST" vs "Central Time"; the email
preview frame cuts off the footer; the printed "Met" column on phones.

## What's working well

One day / Every week first, with hours kept; the live preview of times; the Publish card and Preview link;
Your meetings first after publishing, with Unpublish apart; "Open" tags; the printable summary on phones;
the exact privacy wording; the group's name on the booking page; the contact email is opt-in.

## Limits

An AI review with sample data, not real people.
