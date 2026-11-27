-- L&F :: 0027 a spent handover code must be allowed to become null
--
-- 0022 nulls code_plain once the code has been used ("show once, then never
-- again"), but the column was created `not null`, so the handover itself failed:
--   23502: null value in column "code_plain" of relation "handover_codes"
-- The external patch carried this exact alter and I left it out when porting.
-- The lifecycle run is what found it.

alter table public.handover_codes alter column code_plain drop not null;

comment on column public.handover_codes.code_plain is
  'Plaintext, kept only until first reveal or handover; nulled afterwards. Verification uses code_hash.';

notify pgrst, 'reload schema';
