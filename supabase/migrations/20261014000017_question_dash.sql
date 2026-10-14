-- Writing style: plain hyphen instead of the em dash in user-facing text. The seeded HVAC question
-- (migration 002) and every business's saved copy of it (agent_settings.questions) still had one.
update public.qualification_question_templates
set question = replace(question, ' — ', ' - ')
where question like '%—%';

update public.agent_settings
set questions = replace(questions::text, ' — ', ' - ')::jsonb
where questions::text like '%—%';
