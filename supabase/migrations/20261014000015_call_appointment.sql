-- M3: the visit window the caller chose on an AI call (book_appointment tool).
-- {date, start, end, label, address, notes, at}. Until the calendar exists (M4) this is a request the
-- team confirms; M4 turns it into a real booking.
alter table public.calls add column appointment jsonb;
