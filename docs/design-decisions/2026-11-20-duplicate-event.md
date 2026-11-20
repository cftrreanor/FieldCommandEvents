# Duplicate an event (2026-11-20)

Owner request (from a retrospective after a call with a user): a "Duplicate event" action for hosts that copies the
event's details, jobs, shifts, things-to-bring items, and Coordinator assignments into a new draft; never volunteer
sign-ups or any volunteer's personal details. The host picks the new dates while duplicating, and every shift moves by
the same amount. Coordinators on the copy get a fresh invitation email only once the new event is published. Show where
the action appears for hosts and co-hosts, and confirm the database's privacy rules still apply to the copy.

Found before designing: band contests and festivals already "start from a previous" one (copy_band_contest_setup,
copy_group_event_setup), copying jobs, shifts, and things to bring with dates moved, but not Coordinators. Volunteer
events and fairs have no copy.

Owner decisions before the mock-ups:
- **Kinds:** every kind with jobs (volunteer events, school fairs, band contests, festivals). Band contests and festivals
  also bring their registration setup, so one consistent action replaces "start from a previous".
- **Who:** the Account Host and Co-hosts of every event (the people who can create events). A Co-host of just one event
  sees "Ask [Account Host] to duplicate this event" instead.
- **Coordinators:** copied as invited for the same jobs, not active. When the new event is published, each gets a fresh
  invitation email; they have no access to the new event until they accept. The host can remove anyone before publishing.
