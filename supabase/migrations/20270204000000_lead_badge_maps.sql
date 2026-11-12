-- =============================================================================
-- Volunteer badges: Volunteer Leads can add a map for the back (owner, 2026-11-12).
--
--   * Until now only hosts could add Maps and documents, so a Volunteer Lead printing badges had no way to put a
--     map on the back. Volunteer Leads (can_manage_volunteers) may now add a file that only volunteers and the
--     team see (never directors or the public, never hidden until a date), from the badge page.
--   * They see the files volunteers and the team see, and can remove a file they added themselves (while it's
--     still only for volunteers and the team). Changing files, and every other audience, stays with hosts.
--   * Hosts' policies (event_files.sql) are unchanged; these are added to them.
--
-- Safe to run twice.
-- =============================================================================

drop policy if exists "event files: volunteer leads read the team's" on public.event_files;
create policy "event files: volunteer leads read the team's" on public.event_files
  for select to authenticated
  using (public.can_manage_volunteers(event_id) and audiences && array['volunteers', 'team']);

drop policy if exists "event files: volunteer leads add for volunteers and the team" on public.event_files;
create policy "event files: volunteer leads add for volunteers and the team" on public.event_files
  for insert to authenticated
  with check (
    public.can_manage_volunteers(event_id)
    and created_by = auth.uid()
    and audiences <@ array['volunteers', 'team']
    and visible_from is null
  );

drop policy if exists "event files: volunteer leads remove their own" on public.event_files;
create policy "event files: volunteer leads remove their own" on public.event_files
  for delete to authenticated
  using (
    public.can_manage_volunteers(event_id)
    and created_by = auth.uid()
    and audiences <@ array['volunteers', 'team']
  );
