-- Track YouTube Data API quota consumption per Pacific day.
-- One row per day; `by_endpoint` breaks the total down by API endpoint.
create table if not exists public.youtube_usage (
  day date primary key,
  units integer not null default 0,
  by_endpoint jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- RLS on with no policies: reads/writes are denied to anon and authenticated.
-- Only the service role (which bypasses RLS) records usage or reads metrics.
alter table public.youtube_usage enable row level security;

-- Atomically add units for a day, updating both the running total and the
-- per-endpoint breakdown. SECURITY INVOKER so callers are still RLS-gated.
create or replace function public.record_youtube_units(
  p_day date,
  p_endpoint text,
  p_units integer
) returns void
  language sql
  set search_path to ''
as $$
  insert into public.youtube_usage (day, units, by_endpoint)
  values (p_day, p_units, jsonb_build_object(p_endpoint, p_units))
  on conflict (day) do update set
    units = public.youtube_usage.units + excluded.units,
    by_endpoint = public.youtube_usage.by_endpoint || jsonb_build_object(
      p_endpoint,
      coalesce((public.youtube_usage.by_endpoint ->> p_endpoint)::int, 0) + p_units
    ),
    updated_at = now();
$$;

grant execute on function public.record_youtube_units(date, text, integer) to service_role;
