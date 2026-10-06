-- HVAC taxonomy and default qualification questions (Startup Plan v2.0 p.10).
-- Reference data lives in a migration so every environment has it.

insert into public.taxonomy_values (vertical, category, value, label, sort) values
  ('hvac', 'service', 'repair',         'AC / Heating Repair', 1),
  ('hvac', 'service', 'replacement',    'System Replacement',  2),
  ('hvac', 'service', 'installation',   'New Installation',    3),
  ('hvac', 'service', 'maintenance',    'Maintenance / Tune-up', 4),
  ('hvac', 'service', 'heating',        'Heating',             5),
  ('hvac', 'service', 'emergency',      'Emergency Service',   6),
  ('hvac', 'service', 'other',          'Other',               7),

  ('hvac', 'customer_type', 'homeowner',        'Homeowner',        1),
  ('hvac', 'customer_type', 'renter',           'Renter',           2),
  ('hvac', 'customer_type', 'property_manager', 'Property Manager', 3),
  ('hvac', 'customer_type', 'commercial',       'Commercial',       4),
  ('hvac', 'customer_type', 'unknown',          'Unknown',          5),

  ('hvac', 'urgency', 'emergency',   'Emergency',        1),
  ('hvac', 'urgency', 'within_24h',  'Within 24 hours',  2),
  ('hvac', 'urgency', 'within_7d',   'Within 7 days',    3),
  ('hvac', 'urgency', 'within_30d',  'Within 30 days',   4),
  ('hvac', 'urgency', 'researching', 'Researching',      5),

  ('hvac', 'system_condition', 'not_cooling',     'Not cooling / not heating', 1),
  ('hvac', 'system_condition', 'compressor',      'Compressor issue',          2),
  ('hvac', 'system_condition', 'repeated_repair', 'Repeated repairs',          3),
  ('hvac', 'system_condition', 'old_system',      'Old system (10+ years)',    4),
  ('hvac', 'system_condition', 'unknown',         'Unknown',                   5),

  ('hvac', 'intent', 'high',           'High',             1),
  ('hvac', 'intent', 'medium',         'Medium',           2),
  ('hvac', 'intent', 'low',            'Low',              3),
  ('hvac', 'intent', 'price_shopping', 'Price shopping',   4),
  ('hvac', 'intent', 'information',    'Information only', 5),

  ('hvac', 'call_outcome', 'no_answer',   'No answer',   1),
  ('hvac', 'call_outcome', 'qualified',   'Qualified',   2),
  ('hvac', 'call_outcome', 'booked',      'Booked',      3),
  ('hvac', 'call_outcome', 'transferred', 'Transferred', 4),
  ('hvac', 'call_outcome', 'declined',    'Declined',    5),
  ('hvac', 'call_outcome', 'no_capacity', 'No capacity', 6),

  ('hvac', 'lead_type', 'form', 'Form leads',  1),
  ('hvac', 'lead_type', 'call', 'Phone calls', 2);

insert into public.qualification_question_templates
  (vertical, key, question, answer_type, choices, required, sort) values
  ('hvac', 'service',      'What do you need help with — repair, replacement, installation or maintenance?', 'choice',
     '{repair,replacement,installation,maintenance,heating,emergency,other}', true, 1),
  ('hvac', 'zip_code',     'What is the ZIP code of the property?', 'text', null, true, 2),
  ('hvac', 'homeowner',    'Do you own the home?', 'boolean', null, true, 3),
  ('hvac', 'urgency',      'How soon do you need someone out there?', 'choice',
     '{emergency,within_24h,within_7d,within_30d,researching}', true, 4),
  ('hvac', 'system_age',   'Roughly how old is your system?', 'number', null, false, 5),
  ('hvac', 'problem',      'Can you briefly describe the problem?', 'text', null, false, 6);
