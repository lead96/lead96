-- US ZIP code reference data (GeoNames postal codes, CC BY 4.0 — https://www.geonames.org).
-- Seeded by `npm run db:seed:zips` from supabase/seed/us_zip_codes.csv.
-- Lets the setup chat turn "Miami, 20 miles" into a real ZIP list instead of asking
-- contractors to know their ZIP codes (or letting the AI guess them).
create table public.us_zip_codes (
  zip char(5) primary key,
  city text not null,
  state char(2) not null,
  county text,
  lat double precision not null,
  lng double precision not null
);
create index us_zip_codes_city_idx on public.us_zip_codes (lower(city), state);

alter table public.us_zip_codes enable row level security;
create policy us_zip_codes_select on public.us_zip_codes for select to authenticated using (true);
-- Writes only via the service role (seed script).

-- Cities matching a name (and optional 2-letter state), with their centre point.
-- Several rows = ambiguous city name (e.g. Springfield); the app asks which state.
create function public.zip_city_matches(p_city text, p_state text default null)
returns table (city text, state text, zip_count bigint, lat double precision, lng double precision)
language sql stable security definer set search_path = '' as $$
  select z.city, z.state::text, count(*), avg(z.lat), avg(z.lng)
  from public.us_zip_codes z
  where lower(z.city) = lower(trim(p_city))
    and (p_state is null or z.state = upper(trim(p_state)))
  group by z.city, z.state
  order by count(*) desc;
$$;

-- ZIPs within p_miles of a point, nearest first (haversine, Earth radius 3958.8 mi).
create function public.zips_within(p_lat double precision, p_lng double precision, p_miles double precision, p_limit int default 400)
returns table (zip text, city text, state text, miles double precision)
language sql stable security definer set search_path = '' as $$
  select z.zip::text, z.city, z.state::text, d.miles
  from public.us_zip_codes z
  cross join lateral (
    select 3958.8 * acos(least(1.0,
      cos(radians(p_lat)) * cos(radians(z.lat)) * cos(radians(z.lng) - radians(p_lng))
      + sin(radians(p_lat)) * sin(radians(z.lat)))) as miles
  ) d
  where d.miles <= p_miles
  order by d.miles
  limit p_limit;
$$;

revoke execute on function public.zip_city_matches(text, text) from public, anon;
grant execute on function public.zip_city_matches(text, text) to authenticated;
revoke execute on function public.zips_within(double precision, double precision, double precision, int) from public, anon;
grant execute on function public.zips_within(double precision, double precision, double precision, int) to authenticated;
