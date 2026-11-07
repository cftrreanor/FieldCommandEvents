-- My team part 3, follow-up: when an Account Host offer email last went out, so "Resend email"
-- can wait a few minutes between sends (design decisions 2026-11-07, "Later" items).
-- Server only: the column isn't in the list of columns the browser may read.
alter table public.account_host_handoffs add column last_sent_at timestamptz;
