-- -----------------------------------------------------------------------------
-- 0053_foundry_execution_control
--
-- Durable, provider-neutral execution authority for OmniTwin Foundry. The
-- execution envelope and every approval are immutable evidence. Mutable rows
-- are projections guarded by revision/fencing triggers; provider commands are
-- an inert outbox until a separately deployed consumer claims them.
--
-- IMPORTANT: admitting an execution leaves it in admitted_awaiting_executor.
-- This migration never creates a provider_submit command and contains no
-- provider credentials, network calls, or executor.
-- -----------------------------------------------------------------------------

CREATE FUNCTION "foundry_jsonb_object_key_count"(value_input jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(value_input);
$$;

-- Match reconstruction-foundry stableCanonicalJson for the bounded JSON
-- domains accepted below. Every use of this function is guarded so all numeric
-- leaves are safe integers; trim_scale removes jsonb's otherwise observable
-- distinction between lexical forms such as 1 and 1.0.
CREATE FUNCTION "foundry_canonical_jsonb_text"(value_input jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  canonical_text text;
BEGIN
  CASE jsonb_typeof(value_input)
    WHEN 'array' THEN
      SELECT '[' || COALESCE(string_agg(
        "foundry_canonical_jsonb_text"(element.value), ',' ORDER BY element.ordinality
      ), '') || ']'
      INTO canonical_text
      FROM jsonb_array_elements(value_input) WITH ORDINALITY AS element(value, ordinality);
      RETURN canonical_text;
    WHEN 'object' THEN
      SELECT '{' || COALESCE(string_agg(
        to_jsonb(member.key)::text || ':' || "foundry_canonical_jsonb_text"(member.value),
        ',' ORDER BY member.key COLLATE "C"
      ), '') || '}'
      INTO canonical_text
      FROM jsonb_each(value_input) AS member(key, value);
      RETURN canonical_text;
    WHEN 'number' THEN
      canonical_text := trim_scale((value_input #>> '{}')::numeric)::text;
      RETURN CASE canonical_text WHEN '-0' THEN '0' ELSE canonical_text END;
    ELSE
      RETURN value_input::text;
  END CASE;
END;
$$;

CREATE FUNCTION "foundry_domain_jsonb_sha256"(domain_input text, value_input jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT 'sha256:' || encode(
    sha256(convert_to(domain_input || E'\n' || "foundry_canonical_jsonb_text"(value_input), 'UTF8')),
    'hex'
  );
$$;

CREATE FUNCTION "foundry_nul_domain_jsonb_sha256"(domain_input text, value_input jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT 'sha256:' || encode(
    sha256(
      convert_to(domain_input, 'UTF8')
      || decode('00', 'hex')
      || convert_to("foundry_canonical_jsonb_text"(value_input), 'UTF8')
    ),
    'hex'
  );
$$;

-- Canonicalize finite IEEE-754 binary64 values like ECMAScript JSON.stringify.
-- Starting from PostgreSQL's 17-digit round-trip value, search for the
-- shortest significant-decimal rounding that maps to the same binary64, then
-- apply ECMAScript's fixed/scientific thresholds and exponent spelling.
CREATE FUNCTION "foundry_ecmascript_number_text"(value_input numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
SET extra_float_digits = 3
AS $$
DECLARE
  float_value double precision;
  raw_text text;
  unsigned_raw text;
  mantissa_text text;
  digits_text text;
  explicit_exponent integer := 0;
  scientific_exponent integer;
  decimal_point integer;
  leading_zero_count integer;
  candidate_scale integer;
  raw_numeric numeric;
  candidate_numeric numeric;
  candidate_float double precision;
  chosen_numeric numeric;
  absolute_text text;
  integer_text text;
  fractional_text text;
  significant_text text;
  negative_value boolean;
BEGIN
  IF value_input = 0 THEN
    RETURN '0';
  END IF;
  BEGIN
    float_value := value_input::double precision;
  EXCEPTION
    WHEN numeric_value_out_of_range THEN
      RETURN NULL;
  END;
  IF float_value = 0 THEN
    RETURN '0';
  END IF;
  raw_text := lower(float_value::text);
  IF raw_text IN ('infinity', '-infinity', 'nan') THEN
    RETURN NULL;
  END IF;
  negative_value := left(raw_text, 1) = '-';
  unsigned_raw := CASE WHEN negative_value THEN substr(raw_text, 2) ELSE raw_text END;
  IF strpos(unsigned_raw, 'e') > 0 THEN
    mantissa_text := split_part(unsigned_raw, 'e', 1);
    explicit_exponent := split_part(unsigned_raw, 'e', 2)::integer;
  ELSE
    mantissa_text := unsigned_raw;
  END IF;
  decimal_point := strpos(mantissa_text, '.');
  IF decimal_point = 0 THEN
    decimal_point := length(mantissa_text) + 1;
  END IF;
  digits_text := replace(mantissa_text, '.', '');
  leading_zero_count := length(digits_text) - length(ltrim(digits_text, '0'));
  digits_text := ltrim(digits_text, '0');
  IF digits_text = '' THEN
    RETURN '0';
  END IF;
  scientific_exponent := decimal_point - 1 + explicit_exponent
    - leading_zero_count - 1;
  raw_numeric := raw_text::numeric;
  FOR significant_digits IN 1..17 LOOP
    candidate_scale := significant_digits - scientific_exponent - 1;
    candidate_numeric := round(raw_numeric, candidate_scale);
    BEGIN
      candidate_float := candidate_numeric::double precision;
    EXCEPTION
      WHEN numeric_value_out_of_range THEN
        candidate_float := NULL;
    END;
    IF candidate_float IS NOT NULL AND candidate_float = float_value THEN
      chosen_numeric := candidate_numeric;
      EXIT;
    END IF;
  END LOOP;
  IF chosen_numeric IS NULL THEN
    chosen_numeric := raw_numeric;
  END IF;
  absolute_text := trim_scale(abs(chosen_numeric))::text;
  IF abs(chosen_numeric) >= 1e-6::numeric
     AND abs(chosen_numeric) < 1e21::numeric THEN
    RETURN CASE WHEN chosen_numeric < 0 THEN '-' ELSE '' END || absolute_text;
  END IF;
  IF strpos(absolute_text, '.') > 0 THEN
    integer_text := split_part(absolute_text, '.', 1);
    fractional_text := split_part(absolute_text, '.', 2);
  ELSE
    integer_text := absolute_text;
    fractional_text := '';
  END IF;
  IF integer_text <> '0' THEN
    scientific_exponent := length(integer_text) - 1;
    significant_text := rtrim(integer_text || fractional_text, '0');
  ELSE
    leading_zero_count := length(fractional_text)
      - length(ltrim(fractional_text, '0'));
    scientific_exponent := -(leading_zero_count + 1);
    significant_text := rtrim(ltrim(fractional_text, '0'), '0');
  END IF;
  RETURN CASE WHEN chosen_numeric < 0 THEN '-' ELSE '' END
    || left(significant_text, 1)
    || CASE WHEN length(significant_text) > 1
         THEN '.' || substr(significant_text, 2)
         ELSE ''
       END
    || 'e'
    || CASE WHEN scientific_exponent >= 0 THEN '+' ELSE '-' END
    || abs(scientific_exponent)::text;
END;
$$;

CREATE FUNCTION "foundry_ecmascript_canonical_jsonb_text"(value_input jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  canonical_text text;
BEGIN
  CASE jsonb_typeof(value_input)
    WHEN 'array' THEN
      SELECT CASE
        WHEN count(*) FILTER (WHERE element.canonical_value IS NULL) > 0 THEN NULL
        ELSE '[' || COALESCE(string_agg(
          element.canonical_value, ',' ORDER BY source.ordinality
        ), '') || ']'
      END
      INTO canonical_text
      FROM jsonb_array_elements(value_input) WITH ORDINALITY source(value, ordinality)
      CROSS JOIN LATERAL (
        SELECT "foundry_ecmascript_canonical_jsonb_text"(source.value)
          AS canonical_value
      ) element;
      RETURN canonical_text;
    WHEN 'object' THEN
      SELECT CASE
        WHEN count(*) FILTER (WHERE member.canonical_value IS NULL) > 0 THEN NULL
        ELSE '{' || COALESCE(string_agg(
          to_jsonb(member.key)::text || ':' || member.canonical_value,
          ',' ORDER BY member.key COLLATE "C"
        ), '') || '}'
      END
      INTO canonical_text
      FROM jsonb_each(value_input) source(key, value)
      CROSS JOIN LATERAL (
        SELECT source.key,
          "foundry_ecmascript_canonical_jsonb_text"(source.value)
            AS canonical_value
      ) member;
      RETURN canonical_text;
    WHEN 'number' THEN
      RETURN "foundry_ecmascript_number_text"((value_input #>> '{}')::numeric);
    ELSE
      RETURN value_input::text;
  END CASE;
END;
$$;

CREATE FUNCTION "foundry_ecmascript_domain_jsonb_sha256"(
  domain_input text,
  value_input jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE WHEN canonical.value IS NULL THEN NULL ELSE
    'sha256:' || encode(
      sha256(convert_to(domain_input || E'\n' || canonical.value, 'UTF8')),
      'hex'
    )
  END
  FROM (
    SELECT "foundry_ecmascript_canonical_jsonb_text"(value_input) AS value
  ) canonical;
$$;

CREATE FUNCTION "foundry_jsonb_is_sorted_unique_string_array"(
  value_input jsonb,
  minimum_length integer,
  maximum_length integer
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(value_input) <> 'array' THEN false
    WHEN jsonb_array_length(value_input) NOT BETWEEN minimum_length AND maximum_length THEN false
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(value_input) element
      WHERE jsonb_typeof(element) <> 'string'
    ) THEN false
    ELSE value_input = COALESCE((
      SELECT jsonb_agg(to_jsonb(element_text) ORDER BY element_text COLLATE "C")
      FROM (
        SELECT DISTINCT jsonb_array_elements_text(value_input) AS element_text
      ) unique_elements
    ), '[]'::jsonb)
  END;
$$;

CREATE FUNCTION "foundry_jsonb_is_manifest_key_array"(
  value_input jsonb,
  minimum_length integer,
  maximum_length integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN minimum_length AND maximum_length THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) element(value)
    WHERE jsonb_typeof(element.value) <> 'string'
       OR element.value #>> '{}' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  );
END;
$$;

CREATE FUNCTION "foundry_utf16_length"(value_input text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT COALESCE(sum(
    CASE WHEN ascii(substr(value_input, character_index, 1)) > 65535 THEN 2 ELSE 1 END
  ), 0)::integer
  FROM generate_series(1, char_length(value_input)) character_index;
$$;

CREATE FUNCTION "foundry_utf16_sort_key"(value_input text)
RETURNS bytea
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  sort_key bytea := ''::bytea;
  codepoint integer;
  supplementary_value integer;
  high_surrogate integer;
  low_surrogate integer;
BEGIN
  FOR character_index IN 1..char_length(value_input) LOOP
    codepoint := ascii(substr(value_input, character_index, 1));
    IF codepoint <= 65535 THEN
      sort_key := sort_key || decode(lpad(to_hex(codepoint), 4, '0'), 'hex');
    ELSE
      supplementary_value := codepoint - 65536;
      high_surrogate := 55296 + (supplementary_value / 1024);
      low_surrogate := 56320 + (supplementary_value % 1024);
      sort_key := sort_key
        || decode(lpad(to_hex(high_surrogate), 4, '0'), 'hex')
        || decode(lpad(to_hex(low_surrogate), 4, '0'), 'hex');
    END IF;
  END LOOP;
  RETURN sort_key;
END;
$$;

CREATE FUNCTION "foundry_jsonb_is_unique_string_array"(
  value_input jsonb,
  minimum_length integer,
  maximum_length integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  member_count integer;
  distinct_member_count integer;
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN minimum_length AND maximum_length THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(value_input) element(value)
    WHERE jsonb_typeof(element.value) <> 'string'
  ) THEN
    RETURN false;
  END IF;
  SELECT count(*), count(DISTINCT element.value #>> '{}')
  INTO member_count, distinct_member_count
  FROM jsonb_array_elements(value_input) element(value);
  RETURN member_count = distinct_member_count;
END;
$$;

CREATE FUNCTION "foundry_jsonb_is_bounded_string_array"(
  value_input jsonb,
  minimum_length integer,
  maximum_length integer,
  minimum_member_length integer,
  maximum_member_length integer
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN minimum_length AND maximum_length THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) element(value)
    WHERE jsonb_typeof(element.value) <> 'string'
       OR "foundry_utf16_length"(element.value #>> '{}') NOT BETWEEN
            minimum_member_length AND maximum_member_length
  );
END;
$$;

CREATE FUNCTION "foundry_is_canonical_provider_reference"(value_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  first_codepoint integer;
  last_codepoint integer;
  character_codepoint integer;
  utf16_length integer := 0;
BEGIN
  IF value_input = ''
     OR value_input IS DISTINCT FROM normalize(value_input) THEN
    RETURN false;
  END IF;

  first_codepoint := ascii(substr(value_input, 1, 1));
  last_codepoint := ascii(right(value_input, 1));
  IF first_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR first_codepoint BETWEEN 8192 AND 8202
     OR last_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR last_codepoint BETWEEN 8192 AND 8202 THEN
    RETURN false;
  END IF;

  FOR character_index IN 1..char_length(value_input) LOOP
    character_codepoint := ascii(substr(value_input, character_index, 1));
    utf16_length := utf16_length + CASE WHEN character_codepoint > 65535 THEN 2 ELSE 1 END;
    IF utf16_length > 240
       OR character_codepoint <= 31
       OR character_codepoint = 127 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_canonical_actor"(value_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  first_codepoint integer;
  last_codepoint integer;
  character_codepoint integer;
  utf16_length integer := 0;
BEGIN
  IF value_input = ''
     OR value_input IS DISTINCT FROM normalize(value_input) THEN
    RETURN false;
  END IF;
  first_codepoint := ascii(substr(value_input, 1, 1));
  last_codepoint := ascii(right(value_input, 1));
  IF first_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR first_codepoint BETWEEN 8192 AND 8202
     OR last_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR last_codepoint BETWEEN 8192 AND 8202 THEN
    RETURN false;
  END IF;
  FOR character_index IN 1..char_length(value_input) LOOP
    character_codepoint := ascii(substr(value_input, character_index, 1));
    utf16_length := utf16_length + CASE WHEN character_codepoint > 65535 THEN 2 ELSE 1 END;
    IF utf16_length > 160
       OR character_codepoint <= 31
       OR character_codepoint BETWEEN 127 AND 159
       OR character_codepoint IN (
         173, 1564, 1757, 1807, 6158, 8232, 8233, 8288, 8289, 8290, 8291, 8292,
         65279, 65529, 65530, 65531, 69821, 69837, 917505
       )
       OR character_codepoint BETWEEN 1536 AND 1541
       OR character_codepoint BETWEEN 2192 AND 2193
       OR character_codepoint = 2274
       OR character_codepoint BETWEEN 8203 AND 8207
       OR character_codepoint BETWEEN 8234 AND 8238
       OR character_codepoint BETWEEN 8294 AND 8303
       OR character_codepoint BETWEEN 78896 AND 78911
       OR character_codepoint BETWEEN 113824 AND 113827
       OR character_codepoint BETWEEN 119155 AND 119162
       OR character_codepoint BETWEEN 917536 AND 917631 THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_safe_relative_path"(value_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  first_codepoint integer;
  last_codepoint integer;
  character_codepoint integer;
  utf16_length integer := 0;
  path_part text;
BEGIN
  IF value_input = ''
     OR value_input IS DISTINCT FROM normalize(value_input)
     OR left(value_input, 1) = '/'
     OR value_input ~ '^[A-Za-z]:'
     OR strpos(value_input, chr(92)) > 0
     OR value_input ~ '[<>:"|?*]' THEN
    RETURN false;
  END IF;

  first_codepoint := ascii(substr(value_input, 1, 1));
  last_codepoint := ascii(right(value_input, 1));
  IF first_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR first_codepoint BETWEEN 8192 AND 8202
     OR last_codepoint IN (
       9, 10, 11, 12, 13, 32, 160, 5760, 8232, 8233, 8239, 8287, 12288, 65279
     ) OR last_codepoint BETWEEN 8192 AND 8202 THEN
    RETURN false;
  END IF;

  FOR character_index IN 1..char_length(value_input) LOOP
    character_codepoint := ascii(substr(value_input, character_index, 1));
    utf16_length := utf16_length + CASE WHEN character_codepoint > 65535 THEN 2 ELSE 1 END;
    IF utf16_length > 2048
       OR character_codepoint < 32
       OR character_codepoint = 127
       OR character_codepoint BETWEEN 128 AND 159
       OR character_codepoint BETWEEN 8234 AND 8238
       OR character_codepoint BETWEEN 8294 AND 8297
       OR character_codepoint = 65279 THEN
      RETURN false;
    END IF;
  END LOOP;

  FOREACH path_part IN ARRAY string_to_array(value_input, '/') LOOP
    IF path_part IN ('', '.', '..')
       OR right(path_part, 1) IN ('.', ' ')
       OR upper(split_part(path_part, '.', 1)) = ANY (
         ARRAY['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5',
               'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4',
               'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']
       ) THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_canonical_utc_millisecond_text"(value_input text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  year_value integer;
  month_value integer;
  day_value integer;
  hour_value integer;
  minute_value integer;
  second_value integer;
  maximum_day integer;
BEGIN
  IF value_input
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR left(value_input, 4) = '0000' THEN
    RETURN false;
  END IF;
  year_value := substr(value_input, 1, 4)::integer;
  month_value := substr(value_input, 6, 2)::integer;
  day_value := substr(value_input, 9, 2)::integer;
  hour_value := substr(value_input, 12, 2)::integer;
  minute_value := substr(value_input, 15, 2)::integer;
  second_value := substr(value_input, 18, 2)::integer;
  IF month_value NOT BETWEEN 1 AND 12
     OR hour_value NOT BETWEEN 0 AND 23
     OR minute_value NOT BETWEEN 0 AND 59
     OR second_value NOT BETWEEN 0 AND 59 THEN
    RETURN false;
  END IF;
  maximum_day := CASE month_value
    WHEN 2 THEN CASE
      WHEN year_value % 400 = 0 OR (year_value % 4 = 0 AND year_value % 100 <> 0)
        THEN 29 ELSE 28 END
    WHEN 4 THEN 30
    WHEN 6 THEN 30
    WHEN 9 THEN 30
    WHEN 11 THEN 30
    ELSE 31
  END;
  RETURN day_value BETWEEN 1 AND maximum_day;
END;
$$;

CREATE FUNCTION "foundry_is_provider_capacity_class_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN 1 AND 1000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) capacity(value)
    WHERE jsonb_typeof(capacity.value) <> 'object'
       OR CASE WHEN jsonb_typeof(capacity.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(capacity.value) <> 6
            OR NOT (capacity.value ?& ARRAY[
              'id', 'cpuCores', 'ramGiB', 'gpuCount', 'perGpuVramGiB', 'scratchGiB'
            ])
            OR jsonb_typeof(capacity.value->'id') <> 'string'
            OR capacity.value->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
            OR EXISTS (
              SELECT 1
              FROM (VALUES
                ('positive', capacity.value->'cpuCores', 1024::numeric),
                ('positive', capacity.value->'ramGiB', 100000::numeric),
                ('nonnegative', capacity.value->'gpuCount', 128::numeric),
                ('nonnegative', capacity.value->'perGpuVramGiB', 1000::numeric),
                ('positive', capacity.value->'scratchGiB', 1000000::numeric)
              ) numeric_leaf(requirement, value, maximum_value)
              WHERE jsonb_typeof(numeric_leaf.value) <> 'number'
                 OR CASE WHEN jsonb_typeof(numeric_leaf.value) = 'number' THEN
                      (numeric_leaf.value #>> '{}')::numeric <>
                        trunc((numeric_leaf.value #>> '{}')::numeric)
                      OR (numeric_leaf.value #>> '{}')::numeric > numeric_leaf.maximum_value
                      OR (
                        numeric_leaf.requirement = 'positive'
                        AND (numeric_leaf.value #>> '{}')::numeric <= 0
                      )
                      OR (
                        numeric_leaf.requirement = 'nonnegative'
                        AND (numeric_leaf.value #>> '{}')::numeric < 0
                      )
                    ELSE false END
            )
            OR CASE
                 WHEN jsonb_typeof(capacity.value->'gpuCount') = 'number'
                  AND jsonb_typeof(capacity.value->'perGpuVramGiB') = 'number'
                 THEN (capacity.value->>'gpuCount')::numeric = 0
                  AND (capacity.value->>'perGpuVramGiB')::numeric <> 0
                 ELSE false
               END
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  RETURN value_input = (
    SELECT jsonb_agg(capacity.value ORDER BY capacity.value->>'id' COLLATE "C")
    FROM jsonb_array_elements(value_input) capacity(value)
  ) AND (
    SELECT count(*) = count(DISTINCT capacity.value->>'id')
    FROM jsonb_array_elements(value_input) capacity(value)
  );
END;
$$;

CREATE FUNCTION "foundry_is_job_stage_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN 1 AND 1000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) stage(value)
    WHERE jsonb_typeof(stage.value) <> 'object'
       OR CASE WHEN jsonb_typeof(stage.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(stage.value) <> 16
            OR NOT (stage.value ?& ARRAY[
              'id', 'kind', 'dependsOn', 'containerImage', 'command',
              'inputAssetIds', 'outputNames', 'rightsPurposes', 'cpuCores',
              'ramGiB', 'gpuCount', 'minimumGpuVramGiB', 'scratchGiB',
              'networkAccess', 'checkpoint', 'resumable'
            ])
            OR jsonb_typeof(stage.value->'id') <> 'string'
            OR stage.value->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
            OR jsonb_typeof(stage.value->'kind') <> 'string'
            OR stage.value->>'kind' NOT IN (
              'inspect', 'register', 'align', 'geometry', 'appearance',
              'semantics', 'enhance', 'qa', 'package'
            )
            OR jsonb_typeof(stage.value->'containerImage') <> 'string'
            OR char_length(stage.value->>'containerImage') > 512
            OR stage.value->>'containerImage'
                 !~ '^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$'
            OR "foundry_jsonb_is_manifest_key_array"(
                 stage.value->'dependsOn', 0, 100
               ) IS NOT TRUE
            OR "foundry_jsonb_is_unique_string_array"(
                 stage.value->'dependsOn', 0, 100
               ) IS NOT TRUE
            OR "foundry_jsonb_is_bounded_string_array"(
                 stage.value->'command', 1, 1000, 1, 2048
               ) IS NOT TRUE
            OR "foundry_jsonb_is_manifest_key_array"(
                 stage.value->'inputAssetIds', 0, 100000
               ) IS NOT TRUE
            OR "foundry_jsonb_is_unique_string_array"(
                 stage.value->'inputAssetIds', 0, 100000
               ) IS NOT TRUE
            OR "foundry_jsonb_is_manifest_key_array"(
                 stage.value->'outputNames', 1, 1000
               ) IS NOT TRUE
            OR "foundry_jsonb_is_unique_string_array"(
                 stage.value->'outputNames', 1, 1000
               ) IS NOT TRUE
            OR "foundry_jsonb_is_bounded_string_array"(
                 stage.value->'rightsPurposes', 1, 4, 1, 32
               ) IS NOT TRUE
            OR "foundry_jsonb_is_unique_string_array"(
                 stage.value->'rightsPurposes', 1, 4
               ) IS NOT TRUE
            OR CASE
                 WHEN jsonb_typeof(stage.value->'rightsPurposes') = 'array'
                 THEN EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements_text(stage.value->'rightsPurposes') purpose(value)
                   WHERE purpose.value NOT IN (
                     'commercial_internal_use', 'model_training',
                     'redistribution', 'public_release'
                   )
                 )
                 ELSE false
               END
            OR jsonb_typeof(stage.value->'networkAccess') <> 'string'
            OR stage.value->>'networkAccess' NOT IN (
              'none', 'object_storage_only', 'restricted'
            )
            OR jsonb_typeof(stage.value->'checkpoint') <> 'string'
            OR stage.value->>'checkpoint' NOT IN ('none', 'stage_boundary', 'periodic')
            OR jsonb_typeof(stage.value->'resumable') <> 'boolean'
            OR EXISTS (
                 SELECT 1
                 FROM (VALUES
                   ('positive', stage.value->'cpuCores', 1024::numeric),
                   ('positive', stage.value->'ramGiB', 100000::numeric),
                   ('nonnegative', stage.value->'gpuCount', 128::numeric),
                   ('nonnegative', stage.value->'minimumGpuVramGiB', 1000::numeric),
                   ('positive', stage.value->'scratchGiB', 1000000::numeric)
                 ) numeric_leaf(requirement, value, maximum_value)
                 WHERE jsonb_typeof(numeric_leaf.value) <> 'number'
                    OR CASE WHEN jsonb_typeof(numeric_leaf.value) = 'number' THEN
                         (numeric_leaf.value #>> '{}')::numeric <>
                           trunc((numeric_leaf.value #>> '{}')::numeric)
                         OR (numeric_leaf.value #>> '{}')::numeric > numeric_leaf.maximum_value
                         OR (
                           numeric_leaf.requirement = 'positive'
                           AND (numeric_leaf.value #>> '{}')::numeric <= 0
                         )
                         OR (
                           numeric_leaf.requirement = 'nonnegative'
                           AND (numeric_leaf.value #>> '{}')::numeric < 0
                         )
                       ELSE false END
               )
            OR CASE
                 WHEN jsonb_typeof(stage.value->'gpuCount') = 'number'
                  AND jsonb_typeof(stage.value->'minimumGpuVramGiB') = 'number'
                 THEN (stage.value->>'gpuCount')::numeric = 0
                  AND (stage.value->>'minimumGpuVramGiB')::numeric <> 0
                 ELSE false
               END
            OR CASE
                 WHEN jsonb_typeof(stage.value->'resumable') = 'boolean'
                 THEN (stage.value->>'resumable')::boolean
                  AND stage.value->>'checkpoint' = 'none'
                 ELSE false
               END
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  IF (
    SELECT count(*) <> count(DISTINCT stage.value->>'id')
    FROM jsonb_array_elements(value_input) stage(value)
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) stage(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(stage.value->'dependsOn') dependency(value)
    WHERE dependency.value = stage.value->>'id'
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(value_input) declared_stage(value)
         WHERE declared_stage.value->>'id' = dependency.value
       )
  ) OR EXISTS (
    WITH RECURSIVE edges(stage_id, dependency_id) AS (
      SELECT stage.value->>'id', dependency.value
      FROM jsonb_array_elements(value_input) stage(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(stage.value->'dependsOn') dependency(value)
    ), dependency_walk(origin_id, current_id) AS (
      SELECT edge.stage_id, edge.dependency_id
      FROM edges edge
      UNION
      SELECT dependency_walk.origin_id, edge.dependency_id
      FROM dependency_walk
      JOIN edges edge ON edge.stage_id = dependency_walk.current_id
    )
    SELECT 1 FROM dependency_walk WHERE origin_id = current_id
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_provider_plan_stage_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN 1 AND 1000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) stage(value)
    WHERE jsonb_typeof(stage.value) <> 'object'
       OR CASE WHEN jsonb_typeof(stage.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(stage.value) <> 5
            OR NOT (stage.value ?& ARRAY[
              'stageId', 'capacityClass', 'workerProfileSha256',
              'estimatedCostMicroUsd', 'maximumRuntimeSeconds'
            ])
            OR jsonb_typeof(stage.value->'stageId') <> 'string'
            OR stage.value->>'stageId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
            OR jsonb_typeof(stage.value->'capacityClass') <> 'string'
            OR stage.value->>'capacityClass' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
            OR jsonb_typeof(stage.value->'workerProfileSha256') <> 'string'
            OR stage.value->>'workerProfileSha256' !~ '^sha256:[a-f0-9]{64}$'
            OR jsonb_typeof(stage.value->'estimatedCostMicroUsd') <> 'string'
            OR stage.value->>'estimatedCostMicroUsd' !~ '^(?:0|[1-9][0-9]{0,18})$'
            OR CASE
                 WHEN stage.value->>'estimatedCostMicroUsd'
                        ~ '^(?:0|[1-9][0-9]{0,18})$'
                 THEN (stage.value->>'estimatedCostMicroUsd')::numeric
                        > 9223372036854775807::numeric
                 ELSE false
               END
            OR jsonb_typeof(stage.value->'maximumRuntimeSeconds') <> 'number'
            OR CASE
                 WHEN jsonb_typeof(stage.value->'maximumRuntimeSeconds') = 'number'
                 THEN (stage.value->'maximumRuntimeSeconds' #>> '{}')::numeric
                        <> trunc((stage.value->'maximumRuntimeSeconds' #>> '{}')::numeric)
                   OR (stage.value->'maximumRuntimeSeconds' #>> '{}')::numeric
                        NOT BETWEEN 1 AND 31536000
                 ELSE false
               END
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  RETURN value_input = (
    SELECT jsonb_agg(stage.value ORDER BY stage.value->>'stageId' COLLATE "C")
    FROM jsonb_array_elements(value_input) stage(value)
  ) AND (
    SELECT count(*) = count(DISTINCT stage.value->>'stageId')
    FROM jsonb_array_elements(value_input) stage(value)
  );
END;
$$;

CREATE FUNCTION "foundry_is_ingest_rights"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'object'
     OR "foundry_jsonb_object_key_count"(value_input) <> 7
     OR NOT (value_input ?& ARRAY[
       'basis', 'commercialUse', 'modelTrainingUse', 'redistribution',
       'termsReviewedAt', 'termsReference', 'restrictions'
     ]) THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(value_input->'basis') <> 'string'
     OR jsonb_typeof(value_input->'commercialUse') <> 'string'
     OR jsonb_typeof(value_input->'modelTrainingUse') <> 'string'
     OR jsonb_typeof(value_input->'redistribution') <> 'string'
     OR jsonb_typeof(value_input->'termsReviewedAt') NOT IN ('null', 'string')
     OR jsonb_typeof(value_input->'termsReference') NOT IN ('null', 'string')
     OR jsonb_typeof(value_input->'restrictions') <> 'array' THEN
    RETURN false;
  END IF;
  IF value_input->>'basis' NOT IN (
       'customer_owned', 'explicit_licence', 'vendor_export_terms',
       'written_permission', 'public_domain', 'unknown'
     )
     OR value_input->>'commercialUse' NOT IN (
       'allowed', 'restricted', 'prohibited', 'unknown'
     )
     OR value_input->>'modelTrainingUse' NOT IN (
       'allowed', 'requires_review', 'prohibited', 'unknown'
     )
     OR value_input->>'redistribution' NOT IN (
       'allowed', 'restricted', 'prohibited', 'unknown'
     )
     OR "foundry_jsonb_is_bounded_string_array"(
          value_input->'restrictions', 0, 50, 1, 500
        ) IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF value_input->'termsReviewedAt' <> 'null'::jsonb
     AND "foundry_is_canonical_utc_millisecond_text"(
       value_input->>'termsReviewedAt'
     ) IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF value_input->'termsReference' <> 'null'::jsonb
     AND value_input->>'termsReference' !~ '^https://[^[:space:]]+$' THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_ingest_asset_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(value_input) NOT BETWEEN 1 AND 100000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) asset(value)
    WHERE jsonb_typeof(asset.value) <> 'object'
       OR CASE WHEN jsonb_typeof(asset.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(asset.value) <> 19
            OR NOT (asset.value ?& ARRAY[
              'id', 'sourceRootId', 'relativePath', 'inputType', 'mediaType',
              'sizeBytes', 'sha256', 'immutable', 'captureState', 'accessState',
              'capturedAt', 'coordinateFrameId', 'calibrationAssetIds',
              'parentAssetIds', 'rights', 'provenanceClass', 'evidenceKinds',
              'inspection', 'notes'
            ])
            OR EXISTS (
              SELECT 1
              FROM (VALUES
                ('id'), ('sourceRootId'), ('relativePath'), ('inputType'),
                ('mediaType'), ('sha256'), ('captureState'), ('accessState'),
                ('provenanceClass')
              ) string_leaf(key)
              WHERE jsonb_typeof(asset.value->string_leaf.key) <> 'string'
            )
            OR jsonb_typeof(asset.value->'sizeBytes') <> 'number'
            OR jsonb_typeof(asset.value->'immutable') <> 'boolean'
            OR jsonb_typeof(asset.value->'capturedAt') NOT IN ('null', 'string')
            OR jsonb_typeof(asset.value->'coordinateFrameId') NOT IN ('null', 'string')
            OR jsonb_typeof(asset.value->'calibrationAssetIds') <> 'array'
            OR jsonb_typeof(asset.value->'parentAssetIds') <> 'array'
            OR jsonb_typeof(asset.value->'rights') <> 'object'
            OR jsonb_typeof(asset.value->'evidenceKinds') <> 'array'
            OR jsonb_typeof(asset.value->'inspection') <> 'object'
            OR jsonb_typeof(asset.value->'notes') <> 'array'
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) asset(value)
    WHERE asset.value->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR asset.value->>'sourceRootId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR "foundry_is_safe_relative_path"(asset.value->>'relativePath') IS NOT TRUE
       OR asset.value->>'inputType' NOT IN (
         'matterport_e57', 'matterpak_bundle', 'generic_e57', 'las_laz',
         'xyz_point_cloud', 'ply_point_cloud', 'matterport_panorama',
         'dslr_image', 'generic_image', 'panorama_360', 'phone_image',
         'drone_media', 'video', 'rgbd', 'sensor_log_mcap', 'imu', 'gnss_rtk',
         'xgrids_xbin', 'lcc', 'lcc2', 'spz', 'sog', 'gaussian_ply', 'obj',
         'fbx', 'glb_gltf', 'floor_plan', 'cad_bim', 'openusd',
         'calibration_bundle', 'trajectory', 'control_network',
         'colmap_database', 'colmap_sparse_model', 'manual_evidence',
         'evidence_record'
       )
       OR "foundry_utf16_length"(asset.value->>'mediaType') NOT BETWEEN 1 AND 160
       OR asset.value->>'sha256' !~ '^sha256:[a-f0-9]{64}$'
       OR asset.value->'immutable' IS DISTINCT FROM 'true'::jsonb
       OR asset.value->>'captureState' NOT IN (
         'raw_capture', 'official_export', 'derived', 'reference'
       )
       OR asset.value->>'accessState' NOT IN (
         'direct', 'official_export', 'official_api', 'metadata_only',
         'blocked_technical', 'blocked_legal', 'unknown'
       )
       OR asset.value->>'provenanceClass' NOT IN (
         'captured', 'enhanced_captured', 'generated_cinematic',
         'concept_imagination'
       )
       OR "foundry_jsonb_is_manifest_key_array"(
            asset.value->'calibrationAssetIds', 0, 100
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            asset.value->'calibrationAssetIds', 0, 100
          ) IS NOT TRUE
       OR "foundry_jsonb_is_manifest_key_array"(
            asset.value->'parentAssetIds', 0, 100
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            asset.value->'parentAssetIds', 0, 100
          ) IS NOT TRUE
       OR "foundry_is_ingest_rights"(asset.value->'rights') IS NOT TRUE
       OR "foundry_jsonb_is_bounded_string_array"(
            asset.value->'evidenceKinds', 0, 12, 1, 32
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            asset.value->'evidenceKinds', 0, 12
          ) IS NOT TRUE
       OR "foundry_jsonb_is_bounded_string_array"(
            asset.value->'notes', 0, 50, 1, 500
          ) IS NOT TRUE
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) asset(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(asset.value->'evidenceKinds') evidence(value)
    WHERE evidence.value NOT IN (
      'transform_artifact', 'residual_report', 'projection_operation',
      'quality_report', 'reviewer_attestation', 'scene_authority_map',
      'release_manifest', 'mask', 'provenance_report', 'fixed_view',
      'calibration_record', 'other'
    )
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) asset(value)
    WHERE (asset.value->'sizeBytes' #>> '{}')::numeric < 0
       OR (asset.value->'sizeBytes' #>> '{}')::numeric <>
            trunc((asset.value->'sizeBytes' #>> '{}')::numeric)
       OR (asset.value->'sizeBytes' #>> '{}')::numeric > 9007199254740991::numeric
       OR (
         asset.value->'coordinateFrameId' <> 'null'::jsonb
         AND asset.value->>'coordinateFrameId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       )
       OR (
         asset.value->'capturedAt' <> 'null'::jsonb
         AND "foundry_is_canonical_utc_millisecond_text"(
           asset.value->>'capturedAt'
         ) IS NOT TRUE
       )
       OR (
         asset.value->>'captureState' = 'raw_capture'
         AND (
           asset.value->>'provenanceClass' <> 'captured'
           OR jsonb_array_length(asset.value->'parentAssetIds') <> 0
           OR asset.value->>'accessState' <> 'direct'
         )
       )
       OR (
         asset.value->>'provenanceClass' IN (
           'generated_cinematic', 'concept_imagination'
         )
         AND jsonb_array_length(asset.value->'parentAssetIds') = 0
       )
       OR (
         asset.value->>'inputType' = 'evidence_record'
         AND jsonb_array_length(asset.value->'evidenceKinds') = 0
       )
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) asset(value)
    WHERE "foundry_jsonb_object_key_count"(asset.value->'inspection') <> 6
       OR NOT (asset.value->'inspection' ?& ARRAY[
         'geometryValue', 'appearanceValue', 'calibrationValue', 'scaleValue',
         'metadataKeys', 'decisiveNextTest'
       ])
       OR EXISTS (
         SELECT 1
         FROM (VALUES
           ('geometryValue'), ('appearanceValue'), ('calibrationValue'),
           ('scaleValue'), ('decisiveNextTest')
         ) string_leaf(key)
         WHERE jsonb_typeof(asset.value->'inspection'->string_leaf.key) <> 'string'
       )
       OR jsonb_typeof(asset.value->'inspection'->'metadataKeys') <> 'array'
       OR asset.value->'inspection'->>'geometryValue' NOT IN (
         'none', 'low', 'medium', 'high', 'unknown'
       )
       OR asset.value->'inspection'->>'appearanceValue' NOT IN (
         'none', 'low', 'medium', 'high', 'unknown'
       )
       OR asset.value->'inspection'->>'calibrationValue' NOT IN (
         'none', 'low', 'medium', 'high', 'unknown'
       )
       OR asset.value->'inspection'->>'scaleValue' NOT IN (
         'none', 'low', 'medium', 'high', 'unknown'
       )
       OR "foundry_jsonb_is_bounded_string_array"(
            asset.value->'inspection'->'metadataKeys', 0, 1000, 1, 160
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            asset.value->'inspection'->'metadataKeys', 0, 1000
          ) IS NOT TRUE
       OR "foundry_utf16_length"(
            asset.value->'inspection'->>'decisiveNextTest'
          ) NOT BETWEEN 1 AND 1000
  ) THEN
    RETURN false;
  END IF;
  RETURN (
    SELECT count(*) = count(DISTINCT asset.value->>'id')
    FROM jsonb_array_elements(value_input) asset(value)
  );
END;
$$;

CREATE FUNCTION "foundry_is_execution_ingest_manifest"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'object'
     OR "foundry_jsonb_object_key_count"(value_input) <> 12
     OR NOT (value_input ?& ARRAY[
       'schemaVersion', 'projectId', 'createdAt', 'createdBy', 'sourceRoots',
       'coordinateFrames', 'transforms', 'assets', 'provenanceEdges',
       'generatedRegions', 'legalReviewState', 'sourceMutationPermitted'
     ]) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('schemaVersion'), ('projectId'), ('createdAt'), ('createdBy'),
      ('legalReviewState')
    ) string_leaf(key)
    WHERE jsonb_typeof(value_input->string_leaf.key) <> 'string'
  )
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('sourceRoots'), ('coordinateFrames'), ('transforms'), ('assets'),
         ('provenanceEdges'), ('generatedRegions')
       ) array_leaf(key)
       WHERE jsonb_typeof(value_input->array_leaf.key) <> 'array'
     )
     OR jsonb_typeof(value_input->'sourceMutationPermitted') <> 'boolean' THEN
    RETURN false;
  END IF;
  IF value_input->>'schemaVersion' <> 'omnitwin.foundry.ingest-manifest.v0'
     OR value_input->>'projectId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     OR "foundry_is_canonical_utc_millisecond_text"(
          value_input->>'createdAt'
        ) IS NOT TRUE
     OR value_input->>'createdBy' IS DISTINCT FROM btrim(value_input->>'createdBy')
     OR "foundry_utf16_length"(value_input->>'createdBy') NOT BETWEEN 1 AND 160
     OR value_input->>'legalReviewState' NOT IN (
       'not_reviewed', 'requires_review', 'approved', 'blocked'
     )
     OR value_input->'sourceMutationPermitted' IS DISTINCT FROM 'false'::jsonb
     OR jsonb_array_length(value_input->'sourceRoots') NOT BETWEEN 1 AND 100
     OR jsonb_array_length(value_input->'coordinateFrames') > 10000
     OR jsonb_array_length(value_input->'transforms') > 100000
     OR jsonb_array_length(value_input->'provenanceEdges') > 200000
     OR jsonb_array_length(value_input->'generatedRegions') > 100000
     OR "foundry_is_ingest_asset_array"(value_input->'assets') IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('sourceRoots'), ('coordinateFrames'), ('transforms'),
      ('provenanceEdges'), ('generatedRegions')
    ) array_leaf(key)
    CROSS JOIN LATERAL jsonb_array_elements(value_input->array_leaf.key) element(value)
    WHERE jsonb_typeof(element.value) <> 'object'
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION "foundry_is_intake_capabilities"(
  value_input jsonb,
  local_staging_input text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'object'
     OR "foundry_jsonb_object_key_count"(value_input) <> 7
     OR NOT (value_input ?& ARRAY[
       'localStaging', 'jobPlanning', 'execution', 'modelTraining',
       'signing', 'publication', 'promotion'
     ]) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('localStaging'), ('jobPlanning'), ('execution'), ('modelTraining'),
      ('signing'), ('publication'), ('promotion')
    ) string_leaf(key)
    WHERE jsonb_typeof(value_input->string_leaf.key) <> 'string'
  ) THEN
    RETURN false;
  END IF;
  RETURN local_staging_input IN ('not_performed', 'completed_verified')
    AND value_input->>'localStaging' = local_staging_input
    AND value_input->>'jobPlanning' = 'not_authorized'
    AND value_input->>'execution' = 'not_authorized'
    AND value_input->>'modelTraining' = 'not_authorized'
    AND value_input->>'signing' = 'not_authorized'
    AND value_input->>'publication' = 'not_authorized'
    AND value_input->>'promotion' = 'not_authorized';
END;
$$;

CREATE FUNCTION "foundry_is_intake_exclusion_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array'
     OR jsonb_array_length(value_input) > 100000 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) exclusion(value)
    WHERE jsonb_typeof(exclusion.value) <> 'object'
       OR CASE WHEN jsonb_typeof(exclusion.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(exclusion.value) <> 4
            OR NOT (exclusion.value ?& ARRAY[
              'action', 'path', 'reason', 'rationale'
            ])
            OR EXISTS (
              SELECT 1
              FROM (VALUES
                ('action'), ('path'), ('reason'), ('rationale')
              ) string_leaf(key)
              WHERE jsonb_typeof(exclusion.value->string_leaf.key) <> 'string'
            )
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) exclusion(value)
    WHERE exclusion.value->>'action' <> 'exclude'
       OR "foundry_is_safe_relative_path"(exclusion.value->>'path') IS NOT TRUE
       OR exclusion.value->>'reason' NOT IN (
         'duplicate_content', 'unsupported_format', 'rights_not_cleared',
         'provenance_unknown', 'unrelated_to_project', 'superseded_input',
         'operator_rejected'
       )
       OR exclusion.value->>'rationale'
            IS DISTINCT FROM btrim(exclusion.value->>'rationale')
       OR "foundry_utf16_length"(exclusion.value->>'rationale')
            NOT BETWEEN 1 AND 1000
  ) THEN
    RETURN false;
  END IF;
  RETURN value_input = COALESCE((
    SELECT jsonb_agg(
      exclusion.value
      ORDER BY "foundry_utf16_sort_key"(exclusion.value->>'path')
    )
    FROM jsonb_array_elements(value_input) exclusion(value)
  ), '[]'::jsonb) AND (
    SELECT count(*) = count(DISTINCT exclusion.value->>'path')
    FROM jsonb_array_elements(value_input) exclusion(value)
  );
END;
$$;

CREATE FUNCTION "foundry_is_intake_admission_result"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'object'
     OR "foundry_jsonb_object_key_count"(value_input) <> 9
     OR NOT (value_input ?& ARRAY[
       'schemaVersion', 'receiptSha256', 'reviewSha256', 'manifestSha256',
       'manifest', 'exclusions', 'authority', 'capabilities', 'resultSha256'
     ]) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('schemaVersion'), ('receiptSha256'), ('reviewSha256'),
      ('manifestSha256'), ('authority'), ('resultSha256')
    ) string_leaf(key)
    WHERE jsonb_typeof(value_input->string_leaf.key) <> 'string'
  )
     OR jsonb_typeof(value_input->'manifest') <> 'object'
     OR jsonb_typeof(value_input->'exclusions') <> 'array'
     OR jsonb_typeof(value_input->'capabilities') <> 'object' THEN
    RETURN false;
  END IF;
  IF value_input->>'schemaVersion'
       <> 'omnitwin.foundry.intake-admission-result.v0'
     OR value_input->>'receiptSha256' !~ '^[a-f0-9]{64}$'
     OR value_input->>'reviewSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'manifestSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'resultSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'authority' <> 'none'
     OR "foundry_is_execution_ingest_manifest"(
          value_input->'manifest'
        ) IS NOT TRUE
     OR value_input->'manifest'->>'legalReviewState' = 'approved'
     OR "foundry_is_intake_exclusion_array"(
          value_input->'exclusions'
        ) IS NOT TRUE
     OR "foundry_is_intake_capabilities"(
          value_input->'capabilities', 'not_performed'
        ) IS NOT TRUE THEN
    RETURN false;
  END IF;
  RETURN value_input->>'resultSha256' IS NOT DISTINCT FROM
    "foundry_ecmascript_domain_jsonb_sha256"(
      'omnitwin.foundry.intake-admission-result.v0',
      value_input - 'resultSha256'
    );
END;
$$;

CREATE FUNCTION "foundry_is_intake_staging_file_array"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
BEGIN
  IF jsonb_typeof(value_input) <> 'array'
     OR jsonb_array_length(value_input) NOT BETWEEN 6 AND 100006 THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) file(value)
    WHERE jsonb_typeof(file.value) <> 'object'
       OR CASE WHEN jsonb_typeof(file.value) = 'object' THEN
            "foundry_jsonb_object_key_count"(file.value) <> 4
            OR NOT (file.value ?& ARRAY['path', 'role', 'sizeBytes', 'sha256'])
            OR jsonb_typeof(file.value->'path') <> 'string'
            OR jsonb_typeof(file.value->'role') <> 'string'
            OR jsonb_typeof(file.value->'sizeBytes') <> 'number'
            OR jsonb_typeof(file.value->'sha256') <> 'string'
          ELSE false END
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) file(value)
    WHERE "foundry_is_safe_relative_path"(file.value->>'path') IS NOT TRUE
       OR file.value->>'role' NOT IN (
         'staged_source', 'intake_receipt', 'admission_review',
         'admission_result', 'exclusion_ledger', 'ingest_manifest'
       )
       OR file.value->>'sha256' !~ '^[a-f0-9]{64}$'
       OR (file.value->'sizeBytes' #>> '{}')::numeric < 0
       OR (file.value->'sizeBytes' #>> '{}')::numeric <>
            trunc((file.value->'sizeBytes' #>> '{}')::numeric)
       OR (file.value->'sizeBytes' #>> '{}')::numeric
            > 9007199254740991::numeric
  ) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(value_input) file(value)
    WHERE CASE file.value->>'role'
      WHEN 'staged_source' THEN
        left(file.value->>'path', 7) <> 'source/'
        OR "foundry_is_safe_relative_path"(
             substr(file.value->>'path', 8)
           ) IS NOT TRUE
      WHEN 'intake_receipt' THEN
        file.value->>'path' <> 'evidence/intake-receipt.json'
      WHEN 'admission_review' THEN
        file.value->>'path' <> 'evidence/admission-review.json'
      WHEN 'admission_result' THEN
        file.value->>'path' <> 'evidence/admission-result.json'
      WHEN 'exclusion_ledger' THEN
        file.value->>'path' <> 'evidence/exclusions.json'
      WHEN 'ingest_manifest' THEN
        file.value->>'path' <> 'manifest/foundry-ingest-manifest-v0.json'
      ELSE true
    END
  ) THEN
    RETURN false;
  END IF;
  IF value_input IS DISTINCT FROM (
    SELECT jsonb_agg(
      file.value ORDER BY "foundry_utf16_sort_key"(file.value->>'path')
    )
    FROM jsonb_array_elements(value_input) file(value)
  ) OR (
    SELECT count(*) <> count(DISTINCT file.value->>'path')
    FROM jsonb_array_elements(value_input) file(value)
  ) THEN
    RETURN false;
  END IF;
  RETURN NOT EXISTS (
    SELECT 1
    FROM (VALUES
      ('intake_receipt'), ('admission_review'), ('admission_result'),
      ('exclusion_ledger'), ('ingest_manifest')
    ) required_role(role)
    WHERE (
      SELECT count(*)
      FROM jsonb_array_elements(value_input) file(value)
      WHERE file.value->>'role' = required_role.role
    ) <> 1
  );
END;
$$;

CREATE FUNCTION "foundry_is_intake_staging_index"(value_input jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  expected_staging_sha256 text;
BEGIN
  IF jsonb_typeof(value_input) <> 'object'
     OR "foundry_jsonb_object_key_count"(value_input) <> 12
     OR NOT (value_input ?& ARRAY[
       'schemaVersion', 'receiptSha256', 'reviewSha256', 'resultSha256',
       'manifestSha256', 'stagedAssetCount', 'indexedFileCount', 'totalBytes',
       'files', 'authority', 'capabilities', 'stagingSha256'
     ]) THEN
    RETURN false;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('schemaVersion'), ('receiptSha256'), ('reviewSha256'),
      ('resultSha256'), ('manifestSha256'), ('authority'), ('stagingSha256')
    ) string_leaf(key)
    WHERE jsonb_typeof(value_input->string_leaf.key) <> 'string'
  )
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('stagedAssetCount'), ('indexedFileCount'), ('totalBytes')
       ) numeric_leaf(key)
       WHERE jsonb_typeof(value_input->numeric_leaf.key) <> 'number'
     )
     OR jsonb_typeof(value_input->'files') <> 'array'
     OR jsonb_typeof(value_input->'capabilities') <> 'object' THEN
    RETURN false;
  END IF;
  IF value_input->>'schemaVersion'
       <> 'omnitwin.foundry.intake-staging-index.v0'
     OR value_input->>'receiptSha256' !~ '^[a-f0-9]{64}$'
     OR value_input->>'reviewSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'resultSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'manifestSha256' !~ '^sha256:[a-f0-9]{64}$'
     OR value_input->>'stagingSha256' !~ '^[a-f0-9]{64}$'
     OR value_input->>'authority' <> 'none'
     OR "foundry_is_intake_capabilities"(
          value_input->'capabilities', 'completed_verified'
        ) IS NOT TRUE
     OR "foundry_is_intake_staging_file_array"(
          value_input->'files'
        ) IS NOT TRUE THEN
    RETURN false;
  END IF;
  IF (value_input->'stagedAssetCount' #>> '{}')::numeric < 1
     OR (value_input->'stagedAssetCount' #>> '{}')::numeric > 100000
     OR (value_input->'indexedFileCount' #>> '{}')::numeric < 1
     OR (value_input->'indexedFileCount' #>> '{}')::numeric > 100006
     OR (value_input->'totalBytes' #>> '{}')::numeric < 1
     OR (value_input->'totalBytes' #>> '{}')::numeric > 9007199254740991::numeric
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         (value_input->'stagedAssetCount'),
         (value_input->'indexedFileCount'),
         (value_input->'totalBytes')
       ) numeric_leaf(value)
       WHERE (numeric_leaf.value #>> '{}')::numeric <>
         trunc((numeric_leaf.value #>> '{}')::numeric)
     ) THEN
    RETURN false;
  END IF;
  IF (value_input->>'indexedFileCount')::numeric <>
       jsonb_array_length(value_input->'files')::numeric
     OR (value_input->>'stagedAssetCount')::numeric <> (
       SELECT count(*)::numeric
       FROM jsonb_array_elements(value_input->'files') file(value)
       WHERE file.value->>'role' = 'staged_source'
     )
     OR (value_input->>'totalBytes')::numeric <> (
       SELECT sum((file.value->'sizeBytes' #>> '{}')::numeric)
       FROM jsonb_array_elements(value_input->'files') file(value)
     ) THEN
    RETURN false;
  END IF;
  expected_staging_sha256 := "foundry_nul_domain_jsonb_sha256"(
    'VENVIEWER_FOUNDRY_INTAKE_STAGING_INDEX_V0',
    value_input - 'stagingSha256'
  );
  RETURN value_input->>'stagingSha256' = substr(expected_staging_sha256, 8);
END;
$$;

CREATE FUNCTION "foundry_stage_graph_critical_path_seconds"(stages_input jsonb)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  stage_record record;
  dependency_record record;
  critical_paths jsonb := '{}'::jsonb;
  dependency_maximum numeric;
  stage_runtime numeric;
  progress_made boolean;
BEGIN
  IF jsonb_typeof(stages_input) <> 'array' THEN
    RETURN NULL;
  END IF;
  IF jsonb_array_length(stages_input) = 0 THEN
    RETURN 0;
  END IF;

  FOR iteration IN 1..jsonb_array_length(stages_input) LOOP
    progress_made := false;
    FOR stage_record IN
      SELECT stage.value
      FROM jsonb_array_elements(stages_input) stage(value)
      ORDER BY stage.value->>'stageId' COLLATE "C"
    LOOP
      IF critical_paths ? (stage_record.value->>'stageId') THEN
        CONTINUE;
      END IF;
      IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(stage_record.value->'dependsOn') dependency(value)
        WHERE NOT (critical_paths ? dependency.value)
      ) THEN
        CONTINUE;
      END IF;
      dependency_maximum := 0;
      FOR dependency_record IN
        SELECT dependency.value
        FROM jsonb_array_elements_text(stage_record.value->'dependsOn') dependency(value)
      LOOP
        dependency_maximum := GREATEST(
          dependency_maximum,
          (critical_paths->>dependency_record.value)::numeric
        );
      END LOOP;
      stage_runtime := (stage_record.value->>'maximumRuntimeSeconds')::numeric;
      critical_paths := jsonb_set(
        critical_paths,
        ARRAY[stage_record.value->>'stageId'],
        to_jsonb(dependency_maximum + stage_runtime),
        true
      );
      progress_made := true;
    END LOOP;
    EXIT WHEN "foundry_jsonb_object_key_count"(critical_paths)
      = jsonb_array_length(stages_input);
    IF NOT progress_made THEN
      RETURN NULL;
    END IF;
  END LOOP;

  RETURN (
    SELECT COALESCE(max((critical_path.value #>> '{}')::numeric), 0)
    FROM jsonb_each(critical_paths) critical_path(key, value)
  );
END;
$$;

CREATE TABLE "foundry_execution_policies" (
  "execution_policy_sha256" varchar(71) PRIMARY KEY NOT NULL,
  "policy_id" varchar(120) NOT NULL,
  "schema_version" varchar(80) NOT NULL,
  "maximum_attempts" integer NOT NULL,
  "deterministic_retry_delay_seconds" jsonb NOT NULL,
  "maximum_wall_clock_seconds" integer NOT NULL,
  "orchestration_overhead_seconds" integer NOT NULL,
  "worker_self_deadline_seconds" integer NOT NULL,
  "provider_maximum_execution_ttl_seconds" integer NOT NULL,
  "dispatch_window_ttl_seconds" integer NOT NULL,
  "lease_ttl_seconds" integer NOT NULL,
  "heartbeat_interval_seconds" integer NOT NULL,
  "observation_interval_seconds" integer NOT NULL,
  "checkpoint_interval_seconds" integer,
  "cancel_grace_period_seconds" integer NOT NULL,
  "termination_grace_period_seconds" integer NOT NULL,
  "termination_confirmation_timeout_seconds" integer NOT NULL,
  "pricing_snapshot_maximum_age_seconds" integer NOT NULL,
  "cost_observation_maximum_age_seconds" integer NOT NULL,
  "execution_confirmation_ttl_seconds" integer NOT NULL,
  "compute_approval_ttl_seconds" integer NOT NULL,
  "cost_warning_micro_usd" bigint NOT NULL,
  "cost_hard_stop_micro_usd" bigint NOT NULL,
  "termination_reserve_micro_usd" bigint NOT NULL,
  "absolute_cost_cap_micro_usd" bigint NOT NULL,
  "policy_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_policy_id_digest_unique" UNIQUE("policy_id", "execution_policy_sha256"),
  CONSTRAINT "foundry_policy_runtime_exact_unique" UNIQUE(
    "execution_policy_sha256", "maximum_wall_clock_seconds", "orchestration_overhead_seconds",
    "worker_self_deadline_seconds", "provider_maximum_execution_ttl_seconds",
    "cancel_grace_period_seconds", "termination_grace_period_seconds",
    "termination_confirmation_timeout_seconds", "cost_warning_micro_usd",
    "cost_hard_stop_micro_usd", "termination_reserve_micro_usd", "absolute_cost_cap_micro_usd"
  ),
  CONSTRAINT "foundry_policy_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_policy_digest_shapes" CHECK (
    "execution_policy_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_policy_attempts" CHECK (
    "maximum_attempts" = 1 AND "deterministic_retry_delay_seconds" = '[]'::jsonb
  ),
  CONSTRAINT "foundry_policy_durations" CHECK (
    "maximum_wall_clock_seconds" BETWEEN 1 AND 31536000
    AND "orchestration_overhead_seconds" BETWEEN 0 AND 86400
    AND "worker_self_deadline_seconds" BETWEEN 1 AND 31536000
    AND "provider_maximum_execution_ttl_seconds" BETWEEN 1 AND 31536000
    AND "dispatch_window_ttl_seconds" BETWEEN 1 AND 31536000
    AND "lease_ttl_seconds" BETWEEN 1 AND 31536000
    AND "heartbeat_interval_seconds" BETWEEN 1 AND 31536000
    AND "observation_interval_seconds" BETWEEN 1 AND 31536000
    AND ("checkpoint_interval_seconds" IS NULL
      OR "checkpoint_interval_seconds" BETWEEN 1 AND 31536000)
    AND "cancel_grace_period_seconds" BETWEEN 1 AND 31536000
    AND "termination_grace_period_seconds" BETWEEN 1 AND 31536000
    AND "termination_confirmation_timeout_seconds" BETWEEN 1 AND 31536000
    AND "pricing_snapshot_maximum_age_seconds" BETWEEN 1 AND 31536000
    AND "cost_observation_maximum_age_seconds" BETWEEN 1 AND 31536000
    AND "execution_confirmation_ttl_seconds" BETWEEN 1 AND 31536000
    AND "compute_approval_ttl_seconds" BETWEEN 1 AND 31536000
    AND "lease_ttl_seconds" <= "maximum_wall_clock_seconds"
    AND "heartbeat_interval_seconds" < "lease_ttl_seconds"
    AND "observation_interval_seconds" < "lease_ttl_seconds"
    AND "observation_interval_seconds" <= "cost_observation_maximum_age_seconds"
    AND ("checkpoint_interval_seconds" IS NULL OR "checkpoint_interval_seconds" <= "maximum_wall_clock_seconds")
    AND "maximum_wall_clock_seconds" + "cancel_grace_period_seconds" + "termination_grace_period_seconds" <= "worker_self_deadline_seconds"
    AND "worker_self_deadline_seconds" + "termination_confirmation_timeout_seconds" <= "provider_maximum_execution_ttl_seconds"
    AND "execution_confirmation_ttl_seconds" <= "dispatch_window_ttl_seconds"
    AND "compute_approval_ttl_seconds" <= "dispatch_window_ttl_seconds"
  ),
  CONSTRAINT "foundry_policy_cost_ladder" CHECK (
    "cost_warning_micro_usd" >= 0
    AND "cost_warning_micro_usd" < "cost_hard_stop_micro_usd"
    AND "termination_reserve_micro_usd" >= 0
    AND "cost_hard_stop_micro_usd" + "termination_reserve_micro_usd" <= "absolute_cost_cap_micro_usd"
  ),
  CONSTRAINT "foundry_policy_json" CHECK (
    "schema_version" = 'omnitwin.foundry.execution-policy.v0'
    AND "policy_json" = jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.execution-policy.v0',
      'policyId', "policy_id",
      'maximumAttempts', "maximum_attempts",
      'deterministicRetryDelaySeconds', "deterministic_retry_delay_seconds",
      'maximumWallClockSeconds', "maximum_wall_clock_seconds",
      'orchestrationOverheadSeconds', "orchestration_overhead_seconds",
      'workerSelfDeadlineSeconds', "worker_self_deadline_seconds",
      'providerMaximumExecutionTtlSeconds', "provider_maximum_execution_ttl_seconds",
      'dispatchWindowTtlSeconds', "dispatch_window_ttl_seconds",
      'leaseTtlSeconds', "lease_ttl_seconds",
      'heartbeatIntervalSeconds', "heartbeat_interval_seconds",
      'observationIntervalSeconds', "observation_interval_seconds",
      'checkpointIntervalSeconds', "checkpoint_interval_seconds",
      'cancelGracePeriodSeconds', "cancel_grace_period_seconds",
      'terminationGracePeriodSeconds', "termination_grace_period_seconds",
      'terminationConfirmationTimeoutSeconds', "termination_confirmation_timeout_seconds",
      'pricingSnapshotMaximumAgeSeconds', "pricing_snapshot_maximum_age_seconds",
      'costObservationMaximumAgeSeconds', "cost_observation_maximum_age_seconds",
      'executionConfirmationTtlSeconds', "execution_confirmation_ttl_seconds",
      'computeApprovalTtlSeconds', "compute_approval_ttl_seconds",
      'costWarningMicroUsd', "cost_warning_micro_usd"::text,
      'costHardStopMicroUsd', "cost_hard_stop_micro_usd"::text,
      'terminationReserveMicroUsd', "termination_reserve_micro_usd"::text,
      'absoluteCostCapMicroUsd', "absolute_cost_cap_micro_usd"::text
    )
    AND "execution_policy_sha256" = "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.execution-policy.v0', "policy_json"
    )
  ),
  CONSTRAINT "foundry_policy_text" CHECK (
    "policy_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_provider_adapter_artifacts" (
  "provider_adapter_artifact_sha256" varchar(71) PRIMARY KEY NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "artifact_ref" text NOT NULL,
  "artifact_json" jsonb NOT NULL,
  "reviewed_by" varchar(160) NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_adapter_artifact_exact_unique" UNIQUE(
    "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id", "provider_adapter_version"
  ),
  CONSTRAINT "foundry_adapter_artifact_actor_idem_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_adapter_artifact_provider" CHECK (
    "provider_kind" IN ('local_cpu', 'local_cuda', 'runpod', 'aws', 'azure', 'gcp', 'self_hosted_cluster', 'other')
  ),
  CONSTRAINT "foundry_adapter_artifact_version" CHECK (
    "provider_adapter_version" ~ '^(?:(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?|git-[a-f0-9]{40}|sha256-[a-f0-9]{64})$'
  ),
  CONSTRAINT "foundry_adapter_artifact_digests" CHECK (
    "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_adapter_artifact_times" CHECK (
    "reviewed_at" < "expires_at" AND "reviewed_at" <= "registered_at"
  ),
  CONSTRAINT "foundry_adapter_artifact_json_object" CHECK (jsonb_typeof("artifact_json") = 'object'),
  CONSTRAINT "foundry_adapter_artifact_text" CHECK (
    char_length(btrim("artifact_ref")) BETWEEN 1 AND 2048
    AND "foundry_is_canonical_actor"("reviewed_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_provider_deployments" (
  "provider_deployment_sha256" varchar(71) PRIMARY KEY NOT NULL,
  "deployment_id" varchar(120) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "account_project_alias" varchar(120) NOT NULL,
  "region" varchar(120) NOT NULL,
  "data_residency" varchar(120) NOT NULL,
  "observed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "deployment_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_deployment_adapter_fk" FOREIGN KEY(
    "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id", "provider_adapter_version"
  ) REFERENCES "foundry_provider_adapter_artifacts"(
    "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id", "provider_adapter_version"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_deployment_exact_unique" UNIQUE(
    "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256"
  ),
  CONSTRAINT "foundry_deployment_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_deployment_digest_shapes" CHECK (
    "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_deployment_times" CHECK (
    "observed_at" < "expires_at" AND "observed_at" <= "registered_at"
    AND "observed_at" = date_trunc('milliseconds', "observed_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "observed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_deployment_json" CHECK (
    jsonb_typeof("deployment_json") = 'object'
    AND "foundry_jsonb_object_key_count"("deployment_json") = 12
    AND "deployment_json" ?& ARRAY[
      'schemaVersion', 'deploymentId', 'providerKind', 'providerAdapterId',
      'providerAdapterVersion', 'providerAdapterArtifactSha256',
      'accountProjectAlias', 'region', 'dataResidency', 'observedAt',
      'expiresAt', 'capacityClasses'
    ]
    AND jsonb_typeof("deployment_json"->'schemaVersion') = 'string'
    AND jsonb_typeof("deployment_json"->'deploymentId') = 'string'
    AND jsonb_typeof("deployment_json"->'providerKind') = 'string'
    AND jsonb_typeof("deployment_json"->'providerAdapterId') = 'string'
    AND jsonb_typeof("deployment_json"->'providerAdapterVersion') = 'string'
    AND jsonb_typeof("deployment_json"->'providerAdapterArtifactSha256') = 'string'
    AND jsonb_typeof("deployment_json"->'accountProjectAlias') = 'string'
    AND jsonb_typeof("deployment_json"->'region') = 'string'
    AND jsonb_typeof("deployment_json"->'dataResidency') = 'string'
    AND jsonb_typeof("deployment_json"->'observedAt') = 'string'
    AND jsonb_typeof("deployment_json"->'expiresAt') = 'string'
    AND jsonb_typeof("deployment_json"->'capacityClasses') = 'array'
    AND "deployment_json"->>'schemaVersion'
      IS NOT DISTINCT FROM 'omnitwin.foundry.provider-deployment-evidence.v0'
    AND "deployment_json"->>'deploymentId' IS NOT DISTINCT FROM "deployment_id"
    AND "deployment_json"->>'providerKind' IS NOT DISTINCT FROM "provider_kind"
    AND "deployment_json"->>'providerAdapterId' IS NOT DISTINCT FROM "provider_adapter_id"
    AND "deployment_json"->>'providerAdapterVersion'
      IS NOT DISTINCT FROM "provider_adapter_version"
    AND "deployment_json"->>'providerAdapterArtifactSha256'
      IS NOT DISTINCT FROM "provider_adapter_artifact_sha256"
    AND "deployment_json"->>'accountProjectAlias'
      IS NOT DISTINCT FROM "account_project_alias"
    AND "deployment_json"->>'region' IS NOT DISTINCT FROM "region"
    AND "deployment_json"->>'dataResidency' IS NOT DISTINCT FROM "data_residency"
    AND "deployment_json"->>'observedAt' IS NOT DISTINCT FROM to_char(
      "observed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND "deployment_json"->>'expiresAt' IS NOT DISTINCT FROM to_char(
      "expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND "foundry_is_provider_capacity_class_array"(
      "deployment_json"->'capacityClasses'
    )
    AND "provider_deployment_sha256" = "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.provider-deployment-evidence.v0', "deployment_json"
    )
  ),
  CONSTRAINT "foundry_deployment_text" CHECK (
    "deployment_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "account_project_alias" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "region" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "data_residency" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_provider_request_profiles" (
  "provider_request_profile_sha256" varchar(71) PRIMARY KEY NOT NULL,
  "profile_id" varchar(120) NOT NULL,
  "profile_version" varchar(120) NOT NULL,
  "schema_version" varchar(80) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_adapter_configuration_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "target_kind" varchar(30) NOT NULL,
  "target_id" varchar(120) NOT NULL,
  "maximum_api_call_seconds" integer NOT NULL,
  "profile_json" jsonb NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_provider_request_profile_deployment_fk" FOREIGN KEY(
    "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256"
  ) REFERENCES "foundry_provider_deployments"(
    "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_provider_request_profile_id_version_unique" UNIQUE(
    "profile_id", "profile_version"
  ),
  CONSTRAINT "foundry_provider_request_profile_exact_unique" UNIQUE(
    "provider_request_profile_sha256", "profile_id", "profile_version",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_adapter_configuration_sha256",
    "provider_deployment_sha256"
  ),
  CONSTRAINT "foundry_provider_request_profile_actor_idem_unique" UNIQUE(
    "registered_by_user_id", "idempotency_key"
  ),
  CONSTRAINT "foundry_provider_request_profile_provider" CHECK (
    "provider_kind" IN (
      'local_cpu', 'local_cuda', 'runpod', 'aws', 'azure', 'gcp',
      'self_hosted_cluster', 'other'
    )
  ),
  CONSTRAINT "foundry_provider_request_profile_target" CHECK (
    "target_kind" IN ('local_worker', 'remote_worker_pool')
    AND (("provider_kind" IN ('local_cpu', 'local_cuda')) = ("target_kind" = 'local_worker'))
  ),
  CONSTRAINT "foundry_provider_request_profile_digests" CHECK (
    "provider_request_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_configuration_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_provider_request_profile_times" CHECK (
    "reviewed_at" < "expires_at" AND "reviewed_at" <= "registered_at"
    AND "reviewed_at" = date_trunc('milliseconds', "reviewed_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "reviewed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_provider_request_profile_text" CHECK (
    "schema_version" = 'omnitwin.foundry.provider-request-profile.v0'
    AND "profile_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "profile_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "target_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "maximum_api_call_seconds" BETWEEN 1 AND 300
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  ),
  CONSTRAINT "foundry_provider_request_profile_json" CHECK (
    jsonb_typeof("profile_json") = 'object'
    AND "foundry_jsonb_object_key_count"("profile_json") = 18
    AND "profile_json" ?& ARRAY[
      'schemaVersion', 'profileId', 'profileVersion', 'providerKind',
      'providerAdapterId', 'providerAdapterVersion',
      'providerAdapterArtifactSha256', 'providerAdapterConfigurationSha256',
      'providerDeploymentSha256', 'target',
      'allowedContainerImages', 'allowedNetworkAccess', 'allowedCapacityClasses',
      'allowedObjectStorageProfiles', 'supportedCommandKinds',
      'maximumApiCallSeconds', 'reviewedAt', 'expiresAt'
    ]
    AND jsonb_typeof("profile_json"->'schemaVersion') = 'string'
    AND jsonb_typeof("profile_json"->'profileId') = 'string'
    AND jsonb_typeof("profile_json"->'profileVersion') = 'string'
    AND jsonb_typeof("profile_json"->'providerKind') = 'string'
    AND jsonb_typeof("profile_json"->'providerAdapterId') = 'string'
    AND jsonb_typeof("profile_json"->'providerAdapterVersion') = 'string'
    AND jsonb_typeof("profile_json"->'providerAdapterArtifactSha256') = 'string'
    AND jsonb_typeof("profile_json"->'providerAdapterConfigurationSha256') = 'string'
    AND jsonb_typeof("profile_json"->'providerDeploymentSha256') = 'string'
    AND jsonb_typeof("profile_json"->'maximumApiCallSeconds') = 'number'
    AND jsonb_typeof("profile_json"->'reviewedAt') = 'string'
    AND jsonb_typeof("profile_json"->'expiresAt') = 'string'
    AND "profile_json"->>'schemaVersion' IS NOT DISTINCT FROM "schema_version"
    AND "profile_json"->>'profileId' IS NOT DISTINCT FROM "profile_id"
    AND "profile_json"->>'profileVersion' IS NOT DISTINCT FROM "profile_version"
    AND "profile_json"->>'providerKind' IS NOT DISTINCT FROM "provider_kind"
    AND "profile_json"->>'providerAdapterId' IS NOT DISTINCT FROM "provider_adapter_id"
    AND "profile_json"->>'providerAdapterVersion' IS NOT DISTINCT FROM "provider_adapter_version"
    AND "profile_json"->>'providerAdapterArtifactSha256'
      IS NOT DISTINCT FROM "provider_adapter_artifact_sha256"
    AND "profile_json"->>'providerAdapterConfigurationSha256'
      IS NOT DISTINCT FROM "provider_adapter_configuration_sha256"
    AND "profile_json"->>'providerDeploymentSha256'
      IS NOT DISTINCT FROM "provider_deployment_sha256"
    AND ("profile_json"->'maximumApiCallSeconds' #>> '{}')::numeric
      IS NOT DISTINCT FROM "maximum_api_call_seconds"::numeric
    AND "profile_json"->>'reviewedAt' IS NOT DISTINCT FROM to_char(
      "reviewed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND "profile_json"->>'expiresAt' IS NOT DISTINCT FROM to_char(
      "expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND jsonb_typeof("profile_json"->'target') = 'object'
    AND "foundry_jsonb_object_key_count"("profile_json"->'target') = 2
    AND "profile_json"->'target'->>'targetKind' IS NOT DISTINCT FROM "target_kind"
    AND CASE "target_kind"
      WHEN 'local_worker' THEN
        "profile_json"->'target' ?& ARRAY['targetKind', 'runnerProfileId']
        AND jsonb_typeof("profile_json"->'target'->'targetKind') = 'string'
        AND jsonb_typeof("profile_json"->'target'->'runnerProfileId') = 'string'
        AND "profile_json"->'target'->>'runnerProfileId' IS NOT DISTINCT FROM "target_id"
      WHEN 'remote_worker_pool' THEN
        "profile_json"->'target' ?& ARRAY['targetKind', 'poolId']
        AND jsonb_typeof("profile_json"->'target'->'targetKind') = 'string'
        AND jsonb_typeof("profile_json"->'target'->'poolId') = 'string'
        AND "profile_json"->'target'->>'poolId' IS NOT DISTINCT FROM "target_id"
      ELSE false
    END
    AND jsonb_typeof("profile_json"->'allowedContainerImages') = 'array'
    AND jsonb_typeof("profile_json"->'allowedNetworkAccess') = 'array'
    AND jsonb_typeof("profile_json"->'allowedCapacityClasses') = 'array'
    AND jsonb_typeof("profile_json"->'allowedObjectStorageProfiles') = 'array'
    AND jsonb_typeof("profile_json"->'supportedCommandKinds') = 'array'
    AND "foundry_jsonb_is_sorted_unique_string_array"(
      "profile_json"->'allowedContainerImages', 1, 1000
    )
    AND "foundry_jsonb_is_sorted_unique_string_array"(
      "profile_json"->'allowedNetworkAccess', 1, 3
    )
    AND "foundry_jsonb_is_sorted_unique_string_array"(
      "profile_json"->'allowedCapacityClasses', 1, 1000
    )
    AND "foundry_jsonb_is_sorted_unique_string_array"(
      "profile_json"->'allowedObjectStorageProfiles', 0, 1000
    )
    AND "foundry_jsonb_is_sorted_unique_string_array"(
      "profile_json"->'supportedCommandKinds', 4, 5
    )
    AND "provider_request_profile_sha256" = "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.provider-request-profile.v0', "profile_json"
    )
  )
);

CREATE TABLE "foundry_trusted_worker_profiles" (
  "worker_profile_sha256" varchar(71) PRIMARY KEY NOT NULL,
  "profile_id" varchar(120) NOT NULL,
  "profile_version" varchar(120) NOT NULL,
  "operation_class" varchar(40) NOT NULL,
  "container_image" text NOT NULL,
  "network_access" varchar(30) NOT NULL,
  "local_execution_allowed" boolean NOT NULL,
  "profile_json" jsonb NOT NULL,
  "reviewed_by" varchar(160) NOT NULL,
  "reviewed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_worker_profile_id_version_unique" UNIQUE("profile_id", "profile_version"),
  CONSTRAINT "foundry_worker_profile_exact_unique" UNIQUE("worker_profile_sha256", "operation_class"),
  CONSTRAINT "foundry_worker_profile_actor_idem_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_worker_profile_operation" CHECK (
    "operation_class" IN ('read_only_inspection', 'deterministic_transformation', 'model_inference', 'model_training', 'redistribution_packaging', 'public_release')
  ),
  CONSTRAINT "foundry_worker_profile_network" CHECK (
    "network_access" IN ('none', 'object_storage_only', 'restricted')
  ),
  CONSTRAINT "foundry_worker_profile_local_safety" CHECK (
    NOT ("operation_class" IN ('model_training', 'public_release') AND "local_execution_allowed")
  ),
  CONSTRAINT "foundry_worker_profile_digests" CHECK (
    "worker_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_worker_profile_image" CHECK (
    "container_image" ~ '^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_worker_profile_times" CHECK (
    "reviewed_at" < "expires_at" AND "reviewed_at" <= "registered_at"
    AND "reviewed_at" = date_trunc('milliseconds', "reviewed_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "reviewed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_worker_profile_json" CHECK (
    jsonb_typeof("profile_json") = 'object'
    AND "foundry_jsonb_object_key_count"("profile_json") = 11
    AND "profile_json" ?& ARRAY[
      'schemaVersion', 'profileId', 'profileVersion', 'operationClass',
      'containerImage', 'command', 'networkAccess', 'localExecutionAllowed',
      'reviewedBy', 'reviewedAt', 'expiresAt'
    ]
    AND jsonb_typeof("profile_json"->'schemaVersion') = 'string'
    AND jsonb_typeof("profile_json"->'profileId') = 'string'
    AND jsonb_typeof("profile_json"->'profileVersion') = 'string'
    AND jsonb_typeof("profile_json"->'operationClass') = 'string'
    AND jsonb_typeof("profile_json"->'containerImage') = 'string'
    AND jsonb_typeof("profile_json"->'command') = 'array'
    AND jsonb_typeof("profile_json"->'networkAccess') = 'string'
    AND jsonb_typeof("profile_json"->'localExecutionAllowed') = 'boolean'
    AND jsonb_typeof("profile_json"->'reviewedBy') = 'string'
    AND jsonb_typeof("profile_json"->'reviewedAt') = 'string'
    AND jsonb_typeof("profile_json"->'expiresAt') = 'string'
    AND "profile_json"->>'schemaVersion'
      IS NOT DISTINCT FROM 'omnitwin.foundry.trusted-worker-profile.v0'
    AND "profile_json"->>'profileId' IS NOT DISTINCT FROM "profile_id"
    AND "profile_json"->>'profileVersion' IS NOT DISTINCT FROM "profile_version"
    AND "profile_json"->>'operationClass' IS NOT DISTINCT FROM "operation_class"
    AND "profile_json"->>'containerImage' IS NOT DISTINCT FROM "container_image"
    AND "foundry_jsonb_is_bounded_string_array"(
      "profile_json"->'command', 1, 1000, 1, 2048
    )
    AND "profile_json"->>'networkAccess' IS NOT DISTINCT FROM "network_access"
    AND "profile_json"->'localExecutionAllowed' = to_jsonb("local_execution_allowed")
    AND "profile_json"->>'reviewedBy' IS NOT DISTINCT FROM "reviewed_by"
    AND "profile_json"->>'reviewedAt' IS NOT DISTINCT FROM to_char(
      "reviewed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND "profile_json"->>'expiresAt' IS NOT DISTINCT FROM to_char(
      "expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    )
    AND "worker_profile_sha256" = "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.trusted-worker-profile.v0', "profile_json"
    )
  ),
  CONSTRAINT "foundry_worker_profile_text" CHECK (
    "profile_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "profile_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "foundry_is_canonical_actor"("reviewed_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_jobs" (
  "job_id" varchar(120) PRIMARY KEY NOT NULL,
  "envelope_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "schema_version" varchar(80) NOT NULL,
  "execution_intent" varchar(20) NOT NULL,
  "authority" varchar(20) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "provider_plan_sha256" varchar(71) NOT NULL,
  "reviewed_ingest_manifest_sha256" varchar(71) NOT NULL,
  "intake_admission_result_sha256" varchar(71) NOT NULL,
  "intake_staging_index_sha256" varchar(71) NOT NULL,
  "execution_policy_sha256" varchar(71) NOT NULL,
  "compute_approval_id" varchar(120),
  "pricing_snapshot_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "trusted_worker_profile_set_sha256" varchar(71) NOT NULL,
  "trusted_worker_profile_count" integer NOT NULL,
  "pricing_currency" char(3) NOT NULL,
  "pricing_snapshot_observed_at" timestamptz NOT NULL,
  "provider_plan_planned_at" timestamptz NOT NULL,
  "pricing_snapshot_expires_at" timestamptz NOT NULL,
  "estimated_cost_micro_usd" bigint NOT NULL,
  "budget_cap_micro_usd" bigint NOT NULL,
  "cost_warning_micro_usd" bigint NOT NULL,
  "cost_hard_stop_micro_usd" bigint NOT NULL,
  "termination_reserve_micro_usd" bigint NOT NULL,
  "absolute_cost_cap_micro_usd" bigint NOT NULL,
  "max_wall_clock_seconds" integer NOT NULL,
  "orchestration_overhead_seconds" integer NOT NULL,
  "cancel_grace_seconds" integer NOT NULL,
  "termination_grace_seconds" integer NOT NULL,
  "worker_self_deadline_seconds" integer NOT NULL,
  "termination_confirmation_timeout_seconds" integer NOT NULL,
  "provider_maximum_execution_ttl_seconds" integer NOT NULL,
  "kill_switch_enabled" boolean NOT NULL,
  "dispatch_deadline" timestamptz NOT NULL,
  "envelope_created_at" timestamptz NOT NULL,
  "execution_envelope_json" jsonb NOT NULL,
  "job_spec_json" jsonb NOT NULL,
  "reviewed_ingest_manifest_json" jsonb NOT NULL,
  "provider_plan_json" jsonb NOT NULL,
  "intake_admission_result_json" jsonb NOT NULL,
  "intake_staging_index_json" jsonb NOT NULL,
  "execution_policy_json" jsonb NOT NULL,
  "pricing_snapshot_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_jobs_envelope_unique" UNIQUE("envelope_id"),
  CONSTRAINT "foundry_jobs_job_project_unique" UNIQUE("job_id", "project_id"),
  CONSTRAINT "foundry_jobs_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_jobs_confirmation_subject_unique" UNIQUE(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256"
  ),
  CONSTRAINT "foundry_jobs_rights_subject_unique" UNIQUE(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256"
  ),
  CONSTRAINT "foundry_jobs_compute_subject_unique" UNIQUE(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version", "budget_cap_micro_usd",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "compute_approval_id"
  ),
  CONSTRAINT "foundry_jobs_worker_set_unique" UNIQUE(
    "job_id", "project_id", "execution_envelope_sha256", "provider_plan_sha256",
    "trusted_worker_profile_set_sha256"
  ),
  CONSTRAINT "foundry_jobs_exact_envelope_unique" UNIQUE(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_plan_sha256", "reviewed_ingest_manifest_sha256", "execution_policy_sha256",
    "intake_admission_result_sha256", "intake_staging_index_sha256", "pricing_snapshot_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256",
    "trusted_worker_profile_set_sha256", "trusted_worker_profile_count",
    "pricing_snapshot_expires_at", "budget_cap_micro_usd",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
    "absolute_cost_cap_micro_usd", "max_wall_clock_seconds", "orchestration_overhead_seconds", "cancel_grace_seconds",
    "termination_grace_seconds", "worker_self_deadline_seconds",
    "termination_confirmation_timeout_seconds", "provider_maximum_execution_ttl_seconds",
    "dispatch_deadline"
  ),
  CONSTRAINT "foundry_jobs_key_shape" CHECK (
    "job_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "envelope_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "project_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_adapter_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_jobs_adapter_version" CHECK (
    "provider_adapter_version" ~ '^(?:(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9a-z-]+(?:\.[0-9a-z-]+)*)?(?:\+[0-9a-z-]+(?:\.[0-9a-z-]+)*)?|git-[a-f0-9]{40}|sha256-[a-f0-9]{64})$'
  ),
  CONSTRAINT "foundry_jobs_provider_kind" CHECK (
    "provider_kind" IN ('local_cpu', 'local_cuda', 'runpod', 'aws', 'azure', 'gcp', 'self_hosted_cluster', 'other')
  ),
  CONSTRAINT "foundry_jobs_non_authoritative_envelope" CHECK (
    "schema_version" = 'omnitwin.foundry.execution-envelope.v0'
    AND "execution_intent" = 'execute' AND "authority" = 'none'
  ),
  CONSTRAINT "foundry_jobs_compute_approval_coherence" CHECK (
    CASE WHEN "provider_kind" IN ('local_cpu', 'local_cuda')
      THEN "compute_approval_id" IS NULL
      ELSE "compute_approval_id" IS NOT NULL
        AND "compute_approval_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    END
  ),
  CONSTRAINT "foundry_jobs_pricing_currency" CHECK ("pricing_currency" = 'USD'),
  CONSTRAINT "foundry_jobs_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_plan_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "reviewed_ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "intake_admission_result_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "intake_staging_index_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_policy_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "trusted_worker_profile_set_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "pricing_snapshot_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_jobs_cost_ladder" CHECK (
    "estimated_cost_micro_usd" >= 0
    AND "budget_cap_micro_usd" >= "estimated_cost_micro_usd"
    AND "estimated_cost_micro_usd" < "cost_hard_stop_micro_usd"
    AND "cost_warning_micro_usd" >= 0
    AND "cost_hard_stop_micro_usd" > "cost_warning_micro_usd"
    AND "termination_reserve_micro_usd" >= 0
    AND "absolute_cost_cap_micro_usd" >= "cost_hard_stop_micro_usd"
    AND "cost_hard_stop_micro_usd" + "termination_reserve_micro_usd" <= "absolute_cost_cap_micro_usd"
    AND "absolute_cost_cap_micro_usd" <= "budget_cap_micro_usd"
  ),
  CONSTRAINT "foundry_jobs_deadline_ladder" CHECK (
    "max_wall_clock_seconds" > 0
    AND "orchestration_overhead_seconds" >= 0
    AND "cancel_grace_seconds" >= 0
    AND "termination_grace_seconds" >= 0
    AND "worker_self_deadline_seconds" > 0
    AND "termination_confirmation_timeout_seconds" > 0
    AND "provider_maximum_execution_ttl_seconds" > 0
    AND "max_wall_clock_seconds" + "cancel_grace_seconds" + "termination_grace_seconds" <= "worker_self_deadline_seconds"
    AND "worker_self_deadline_seconds" + "termination_confirmation_timeout_seconds" <= "provider_maximum_execution_ttl_seconds"
  ),
  CONSTRAINT "foundry_jobs_timestamps" CHECK (
    "pricing_snapshot_observed_at" <= "provider_plan_planned_at"
    AND "provider_plan_planned_at" <= "envelope_created_at"
    AND "provider_plan_planned_at" < "pricing_snapshot_expires_at"
    AND "envelope_created_at" <= "registered_at"
    AND "envelope_created_at" < "dispatch_deadline"
    AND "dispatch_deadline" <= "pricing_snapshot_expires_at"
    AND "pricing_snapshot_observed_at" = date_trunc('milliseconds', "pricing_snapshot_observed_at")
    AND "provider_plan_planned_at" = date_trunc('milliseconds', "provider_plan_planned_at")
    AND "pricing_snapshot_expires_at" = date_trunc('milliseconds', "pricing_snapshot_expires_at")
    AND "envelope_created_at" = date_trunc('milliseconds', "envelope_created_at")
    AND "dispatch_deadline" = date_trunc('milliseconds', "dispatch_deadline")
    AND "pricing_snapshot_observed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "provider_plan_planned_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "envelope_created_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "pricing_snapshot_expires_at" < timestamptz '10000-01-01 00:00:00+00'
    AND "dispatch_deadline" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_jobs_kill_switch_required" CHECK ("kill_switch_enabled"),
  CONSTRAINT "foundry_jobs_worker_profile_count" CHECK ("trusted_worker_profile_count" BETWEEN 1 AND 1000),
  CONSTRAINT "foundry_jobs_json_objects" CHECK (
    jsonb_typeof("execution_envelope_json") = 'object'
    AND jsonb_typeof("job_spec_json") = 'object'
    AND jsonb_typeof("reviewed_ingest_manifest_json") = 'object'
    AND jsonb_typeof("provider_plan_json") = 'object'
    AND jsonb_typeof("intake_admission_result_json") = 'object'
    AND jsonb_typeof("intake_staging_index_json") = 'object'
    AND jsonb_typeof("execution_policy_json") = 'object'
    AND jsonb_typeof("pricing_snapshot_json") = 'object'
  ),
  CONSTRAINT "foundry_jobs_idempotency_key" CHECK (char_length(btrim("idempotency_key")) BETWEEN 1 AND 160)
  ,CONSTRAINT "foundry_jobs_execution_policy_fk" FOREIGN KEY(
    "execution_policy_sha256", "max_wall_clock_seconds", "orchestration_overhead_seconds",
    "worker_self_deadline_seconds", "provider_maximum_execution_ttl_seconds",
    "cancel_grace_seconds", "termination_grace_seconds", "termination_confirmation_timeout_seconds",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
    "absolute_cost_cap_micro_usd"
  ) REFERENCES "foundry_execution_policies"(
    "execution_policy_sha256", "maximum_wall_clock_seconds", "orchestration_overhead_seconds",
    "worker_self_deadline_seconds", "provider_maximum_execution_ttl_seconds",
    "cancel_grace_period_seconds", "termination_grace_period_seconds", "termination_confirmation_timeout_seconds",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
    "absolute_cost_cap_micro_usd"
  ) ON DELETE RESTRICT
  ,CONSTRAINT "foundry_jobs_adapter_artifact_fk" FOREIGN KEY(
    "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id", "provider_adapter_version"
  ) REFERENCES "foundry_provider_adapter_artifacts"(
    "provider_adapter_artifact_sha256", "provider_kind", "provider_adapter_id", "provider_adapter_version"
  ) ON DELETE RESTRICT
  ,CONSTRAINT "foundry_jobs_deployment_fk" FOREIGN KEY(
    "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256"
  ) REFERENCES "foundry_provider_deployments"(
    "provider_deployment_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256"
  ) ON DELETE RESTRICT
);

CREATE TABLE "foundry_job_worker_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "provider_plan_sha256" varchar(71) NOT NULL,
  "trusted_worker_profile_set_sha256" varchar(71) NOT NULL,
  "stage_id" varchar(120) NOT NULL,
  "worker_profile_sha256" varchar(71) NOT NULL,
  "operation_class" varchar(40) NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_job_worker_set_fk" FOREIGN KEY(
    "job_id", "project_id", "execution_envelope_sha256", "provider_plan_sha256",
    "trusted_worker_profile_set_sha256"
  ) REFERENCES "foundry_jobs"(
    "job_id", "project_id", "execution_envelope_sha256", "provider_plan_sha256",
    "trusted_worker_profile_set_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_job_worker_profile_fk" FOREIGN KEY("worker_profile_sha256", "operation_class")
    REFERENCES "foundry_trusted_worker_profiles"("worker_profile_sha256", "operation_class") ON DELETE RESTRICT,
  CONSTRAINT "foundry_job_worker_stage_unique" UNIQUE("job_id", "stage_id"),
  CONSTRAINT "foundry_job_worker_actor_idem_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_job_worker_digests" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_plan_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "trusted_worker_profile_set_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "worker_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_job_worker_stage_key" CHECK ("stage_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  CONSTRAINT "foundry_job_worker_idempotency_key" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_rights_policy_versions" (
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_evidence_sha256" varchar(71) NOT NULL,
  "generation" bigint NOT NULL,
  "maximum_approval_ttl_seconds" integer NOT NULL,
  "policy_definition_json" jsonb NOT NULL,
  "effective_at" timestamptz NOT NULL,
  "revoked_at" timestamptz,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_rights_policy_pk" PRIMARY KEY("policy_version", "generation"),
  CONSTRAINT "foundry_rights_policy_generation_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "generation"
  ),
  CONSTRAINT "foundry_rights_policy_exact_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "policy_evidence_sha256",
    "generation", "maximum_approval_ttl_seconds"
  ),
  CONSTRAINT "foundry_rights_policy_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_rights_policy_key_shape" CHECK (
    "policy_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_rights_policy_digest_shapes" CHECK (
    "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "policy_evidence_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_rights_policy_definition_object" CHECK (jsonb_typeof("policy_definition_json") = 'object'),
  CONSTRAINT "foundry_rights_policy_times" CHECK (
    ("revoked_at" IS NULL OR "revoked_at" > "effective_at")
    AND "registered_at" <= COALESCE("revoked_at", 'infinity'::timestamptz)
    AND "effective_at" = date_trunc('milliseconds', "effective_at")
    AND ("revoked_at" IS NULL OR "revoked_at" = date_trunc('milliseconds', "revoked_at"))
    AND "effective_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "effective_at" < timestamptz '10000-01-01 00:00:00+00'
    AND ("revoked_at" IS NULL OR (
      "revoked_at" >= timestamptz '0001-01-01 00:00:00+00'
      AND "revoked_at" < timestamptz '10000-01-01 00:00:00+00'
    ))
  ),
  CONSTRAINT "foundry_rights_policy_generation_bounds" CHECK (
    "generation" BETWEEN 1 AND 9007199254740991
    AND "maximum_approval_ttl_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "foundry_rights_policy_idempotency_key" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_rights_policy_revocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_generation" bigint NOT NULL,
  "revoked_at" timestamptz NOT NULL,
  "reason" text NOT NULL,
  "revoked_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_rights_policy_revocation_fk" FOREIGN KEY(
    "policy_version", "policy_definition_sha256", "policy_generation"
  ) REFERENCES "foundry_rights_policy_versions"(
    "policy_version", "policy_definition_sha256", "generation"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_rights_policy_one_revocation_unique" UNIQUE(
    "policy_version", "policy_definition_sha256", "policy_generation"
  ),
  CONSTRAINT "foundry_rights_policy_revocation_actor_idem_unique" UNIQUE("revoked_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_rights_policy_revocation_digests" CHECK (
    "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_rights_policy_revocation_times" CHECK ("revoked_at" <= "recorded_at"),
  CONSTRAINT "foundry_rights_policy_revocation_generation" CHECK (
    "policy_generation" BETWEEN 1 AND 9007199254740991
  ),
  CONSTRAINT "foundry_rights_policy_revocation_text" CHECK (
    char_length(btrim("reason")) BETWEEN 10 AND 4000
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_rights_approvals" (
  "id" varchar(120) PRIMARY KEY NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "reviewed_ingest_manifest_sha256" varchar(71) NOT NULL,
  "execution_policy_sha256" varchar(71) NOT NULL,
  "policy_version" varchar(120) NOT NULL,
  "policy_definition_sha256" varchar(71) NOT NULL,
  "policy_evidence_sha256" varchar(71) NOT NULL,
  "policy_generation" bigint NOT NULL,
  "policy_maximum_approval_ttl_seconds" integer NOT NULL,
  "decision" varchar(20) NOT NULL,
  "decided_by" varchar(160) NOT NULL,
  "decided_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "rights_approval_sha256" varchar(71) NOT NULL,
  "rights_approval_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_rights_job_fk" FOREIGN KEY(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256"
  ) REFERENCES "foundry_jobs"(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_rights_policy_fk" FOREIGN KEY(
    "policy_version", "policy_definition_sha256", "policy_evidence_sha256",
    "policy_generation", "policy_maximum_approval_ttl_seconds"
  ) REFERENCES "foundry_rights_policy_versions"(
    "policy_version", "policy_definition_sha256", "policy_evidence_sha256",
    "generation", "maximum_approval_ttl_seconds"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_rights_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_rights_exact_subject_unique" UNIQUE(
    "id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256", "policy_version",
    "policy_definition_sha256", "policy_evidence_sha256", "policy_generation",
    "policy_maximum_approval_ttl_seconds",
    "rights_approval_sha256"
  ),
  CONSTRAINT "foundry_rights_allowed_only" CHECK ("decision" = 'allowed'),
  CONSTRAINT "foundry_rights_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "reviewed_ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_policy_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "policy_evidence_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_rights_approval_json_object" CHECK (jsonb_typeof("rights_approval_json") = 'object'),
  CONSTRAINT "foundry_rights_times" CHECK (
    "decided_at" < "expires_at" AND "decided_at" <= "registered_at"
    AND "expires_at" <= "decided_at" + make_interval(secs => "policy_maximum_approval_ttl_seconds")
    AND "decided_at" = date_trunc('milliseconds', "decided_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "decided_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_rights_approval_policy_generation" CHECK (
    "policy_generation" BETWEEN 1 AND 9007199254740991
    AND "policy_maximum_approval_ttl_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "foundry_rights_text" CHECK (
    "id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND char_length(btrim("policy_version")) BETWEEN 1 AND 120
    AND "foundry_is_canonical_actor"("decided_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_compute_approvals" (
  "approval_id" varchar(120) PRIMARY KEY NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "job_budget_cap_micro_usd" bigint NOT NULL,
  "maximum_cost_micro_usd" bigint NOT NULL,
  "approved_by" varchar(160) NOT NULL,
  "approved_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "compute_approval_sha256" varchar(71) NOT NULL,
  "compute_approval_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_compute_job_fk" FOREIGN KEY(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "job_budget_cap_micro_usd", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256", "approval_id"
  ) REFERENCES "foundry_jobs"(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version", "budget_cap_micro_usd",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "compute_approval_id"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_compute_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_compute_exact_subject_unique" UNIQUE(
    "approval_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "maximum_cost_micro_usd",
    "compute_approval_sha256"
  ),
  CONSTRAINT "foundry_compute_key_shape" CHECK ("approval_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'),
  CONSTRAINT "foundry_compute_remote_only" CHECK ("provider_kind" NOT IN ('local_cpu', 'local_cuda')),
  CONSTRAINT "foundry_compute_cost" CHECK (
    "job_budget_cap_micro_usd" >= 0
    AND "maximum_cost_micro_usd" >= 0
    AND "maximum_cost_micro_usd" <= "job_budget_cap_micro_usd"
  ),
  CONSTRAINT "foundry_compute_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "compute_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_compute_approval_json_object" CHECK (jsonb_typeof("compute_approval_json") = 'object'),
  CONSTRAINT "foundry_compute_times" CHECK (
    "approved_at" < "expires_at" AND "approved_at" <= "registered_at"
    AND "approved_at" = date_trunc('milliseconds', "approved_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "approved_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_compute_text" CHECK (
    "foundry_is_canonical_actor"("approved_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_execution_confirmations" (
  "confirmation_id" varchar(120) PRIMARY KEY NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "confirmed_by" varchar(160) NOT NULL,
  "confirmed_at" timestamptz NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "confirmation_sha256" varchar(71) NOT NULL,
  "confirmation_json" jsonb NOT NULL,
  "registered_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "registered_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_confirmations_job_fk" FOREIGN KEY(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256"
  ) REFERENCES "foundry_jobs"(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_confirmations_actor_idempotency_unique" UNIQUE("registered_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_confirmations_exact_subject_unique" UNIQUE(
    "confirmation_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "confirmation_sha256"
  ),
  CONSTRAINT "foundry_confirmations_key_shape" CHECK (
    "confirmation_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ),
  CONSTRAINT "foundry_confirmations_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "confirmation_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_confirmation_json_object" CHECK (jsonb_typeof("confirmation_json") = 'object'),
  CONSTRAINT "foundry_confirmations_times" CHECK (
    "confirmed_at" < "expires_at" AND "confirmed_at" <= "registered_at"
    AND "confirmed_at" = date_trunc('milliseconds', "confirmed_at")
    AND "expires_at" = date_trunc('milliseconds', "expires_at")
    AND "confirmed_at" >= timestamptz '0001-01-01 00:00:00+00'
    AND "expires_at" < timestamptz '10000-01-01 00:00:00+00'
  ),
  CONSTRAINT "foundry_confirmations_text" CHECK (
    "foundry_is_canonical_actor"("confirmed_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "execution_subject_json" jsonb NOT NULL,
  "job_spec_sha256" varchar(71) NOT NULL,
  "provider_plan_sha256" varchar(71) NOT NULL,
  "reviewed_ingest_manifest_sha256" varchar(71) NOT NULL,
  "intake_admission_result_sha256" varchar(71) NOT NULL,
  "intake_staging_index_sha256" varchar(71) NOT NULL,
  "execution_policy_sha256" varchar(71) NOT NULL,
  "pricing_snapshot_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "trusted_worker_profile_set_sha256" varchar(71) NOT NULL,
  "trusted_worker_profile_count" integer NOT NULL,
  "pricing_currency" char(3) NOT NULL,
  "pricing_snapshot_expires_at" timestamptz NOT NULL,
  "budget_cap_micro_usd" bigint NOT NULL,
  "cost_warning_micro_usd" bigint NOT NULL,
  "cost_hard_stop_micro_usd" bigint NOT NULL,
  "termination_reserve_micro_usd" bigint NOT NULL,
  "absolute_cost_cap_micro_usd" bigint NOT NULL,
  "max_wall_clock_seconds" integer NOT NULL,
  "orchestration_overhead_seconds" integer NOT NULL,
  "cancel_grace_seconds" integer NOT NULL,
  "termination_grace_seconds" integer NOT NULL,
  "worker_self_deadline_seconds" integer NOT NULL,
  "termination_confirmation_timeout_seconds" integer NOT NULL,
  "provider_maximum_execution_ttl_seconds" integer NOT NULL,
  "dispatch_deadline" timestamptz NOT NULL,
  "rights_approval_id" varchar(120) NOT NULL,
  "rights_approval_sha256" varchar(71) NOT NULL,
  "rights_policy_version" varchar(120) NOT NULL,
  "rights_policy_definition_sha256" varchar(71) NOT NULL,
  "rights_policy_evidence_sha256" varchar(71) NOT NULL,
  "rights_policy_generation" bigint NOT NULL,
  "rights_policy_maximum_approval_ttl_seconds" integer NOT NULL,
  "compute_approval_id" varchar(120),
  "compute_approval_sha256" varchar(71),
  "compute_approval_maximum_cost_micro_usd" bigint,
  "confirmation_id" varchar(120) NOT NULL,
  "confirmation_sha256" varchar(71) NOT NULL,
  "state" varchar(40) NOT NULL DEFAULT 'admitted_awaiting_executor',
  "last_attempt_ordinal" integer NOT NULL DEFAULT 0,
  "fencing_token" bigint NOT NULL DEFAULT 0,
  "total_cost_micro_usd" bigint NOT NULL DEFAULT 0,
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "revision" bigint NOT NULL DEFAULT 0,
  "admitted_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "admitted_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_exec_job_fk" FOREIGN KEY(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_plan_sha256", "reviewed_ingest_manifest_sha256", "execution_policy_sha256",
    "intake_admission_result_sha256", "intake_staging_index_sha256", "pricing_snapshot_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256",
    "trusted_worker_profile_set_sha256", "trusted_worker_profile_count",
    "pricing_snapshot_expires_at", "budget_cap_micro_usd",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
    "absolute_cost_cap_micro_usd", "max_wall_clock_seconds", "orchestration_overhead_seconds", "cancel_grace_seconds",
    "termination_grace_seconds", "worker_self_deadline_seconds",
    "termination_confirmation_timeout_seconds", "provider_maximum_execution_ttl_seconds",
    "dispatch_deadline"
  ) REFERENCES "foundry_jobs"(
    "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_plan_sha256", "reviewed_ingest_manifest_sha256", "execution_policy_sha256",
    "intake_admission_result_sha256", "intake_staging_index_sha256", "pricing_snapshot_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256",
    "trusted_worker_profile_set_sha256", "trusted_worker_profile_count",
    "pricing_snapshot_expires_at", "budget_cap_micro_usd",
    "cost_warning_micro_usd", "cost_hard_stop_micro_usd", "termination_reserve_micro_usd",
    "absolute_cost_cap_micro_usd", "max_wall_clock_seconds", "orchestration_overhead_seconds", "cancel_grace_seconds",
    "termination_grace_seconds", "worker_self_deadline_seconds",
    "termination_confirmation_timeout_seconds", "provider_maximum_execution_ttl_seconds",
    "dispatch_deadline"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_exec_rights_fk" FOREIGN KEY(
    "rights_approval_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256", "rights_policy_version",
    "rights_policy_definition_sha256", "rights_policy_evidence_sha256", "rights_policy_generation",
    "rights_policy_maximum_approval_ttl_seconds", "rights_approval_sha256"
  ) REFERENCES "foundry_rights_approvals"(
    "id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "reviewed_ingest_manifest_sha256", "execution_policy_sha256", "policy_version",
    "policy_definition_sha256", "policy_evidence_sha256", "policy_generation",
    "policy_maximum_approval_ttl_seconds",
    "rights_approval_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_exec_compute_fk" FOREIGN KEY(
    "compute_approval_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256",
    "compute_approval_maximum_cost_micro_usd", "compute_approval_sha256"
  ) REFERENCES "foundry_compute_approvals"(
    "approval_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "maximum_cost_micro_usd",
    "compute_approval_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_exec_confirmation_fk" FOREIGN KEY(
    "confirmation_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "confirmation_sha256"
  ) REFERENCES "foundry_execution_confirmations"(
    "confirmation_id", "job_id", "project_id", "execution_envelope_sha256", "job_spec_sha256",
    "confirmation_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_exec_job_unique" UNIQUE("job_id", "project_id"),
  CONSTRAINT "foundry_exec_confirmation_consumption_unique" UNIQUE("confirmation_id"),
  CONSTRAINT "foundry_exec_actor_idempotency_unique" UNIQUE("admitted_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_exec_scope_unique" UNIQUE(
    "id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ),
  CONSTRAINT "foundry_exec_subject_unique" UNIQUE("id", "execution_subject_sha256"),
  CONSTRAINT "foundry_exec_pricing_unique" UNIQUE("id", "pricing_currency", "pricing_snapshot_sha256"),
  CONSTRAINT "foundry_exec_state" CHECK (
    "state" IN (
      'admitted_awaiting_executor', 'authorized', 'submit_pending', 'provider_unknown',
      'queued', 'running', 'checkpointing', 'stop_pending', 'terminating',
      'termination_unconfirmed', 'validating', 'terminal_succeeded', 'terminal_failed',
      'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded',
      'terminal_validation_failed', 'terminal_provider_lost'
    )
  ),
  CONSTRAINT "foundry_exec_compute_coherence" CHECK (
    CASE WHEN "provider_kind" IN ('local_cpu', 'local_cuda')
      THEN "compute_approval_id" IS NULL AND "compute_approval_sha256" IS NULL
        AND "compute_approval_maximum_cost_micro_usd" IS NULL
      ELSE "compute_approval_id" IS NOT NULL
        AND "compute_approval_sha256" IS NOT NULL
        AND "compute_approval_maximum_cost_micro_usd" IS NOT NULL
        AND "compute_approval_maximum_cost_micro_usd" >= "absolute_cost_cap_micro_usd"
        AND "compute_approval_maximum_cost_micro_usd" <= "budget_cap_micro_usd"
    END
  ),
  CONSTRAINT "foundry_exec_costs" CHECK (
    "total_cost_micro_usd" >= 0
    AND "cost_warning_micro_usd" >= 0
    AND "cost_hard_stop_micro_usd" > "cost_warning_micro_usd"
    AND "termination_reserve_micro_usd" >= 0
    AND "cost_hard_stop_micro_usd" + "termination_reserve_micro_usd" <= "absolute_cost_cap_micro_usd"
    AND "absolute_cost_cap_micro_usd" <= "budget_cap_micro_usd"
  ),
  CONSTRAINT "foundry_exec_counters" CHECK (
    "last_attempt_ordinal" >= 0 AND "fencing_token" >= 0 AND "revision" >= 0
  ),
  CONSTRAINT "foundry_exec_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "job_spec_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_plan_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "reviewed_ingest_manifest_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "intake_admission_result_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "intake_staging_index_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_policy_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "trusted_worker_profile_set_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_approval_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_policy_definition_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "rights_policy_evidence_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND ("compute_approval_sha256" IS NULL OR "compute_approval_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND "confirmation_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "pricing_snapshot_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_exec_timestamps" CHECK (
    "admitted_at" <= "updated_at"
    AND "admitted_at" < "dispatch_deadline"
    AND "dispatch_deadline" <= "pricing_snapshot_expires_at"
  ),
  CONSTRAINT "foundry_exec_worker_profile_count" CHECK (
    "trusted_worker_profile_count" BETWEEN 1 AND 1000
    AND "rights_policy_generation" BETWEEN 1 AND 9007199254740991
    AND "rights_policy_maximum_approval_ttl_seconds" BETWEEN 1 AND 31536000
  ),
  CONSTRAINT "foundry_exec_subject_json_object" CHECK (
    jsonb_typeof("execution_subject_json") = 'object'
  ),
  CONSTRAINT "foundry_exec_idempotency_key" CHECK (char_length(btrim("idempotency_key")) BETWEEN 1 AND 160)
);

CREATE TABLE "foundry_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "state" varchar(40) NOT NULL DEFAULT 'authorized',
  "provider_execution_ref" varchar(240),
  "provider_attempt_ref" varchar(240),
  "lease_owner" varchar(160),
  "lease_expires_at" timestamptz,
  "observed_cost_micro_usd" bigint NOT NULL DEFAULT 0,
  "cancel_requested" boolean NOT NULL DEFAULT false,
  "revision" bigint NOT NULL DEFAULT 0,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "submitted_at" timestamptz,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "wall_clock_deadline" timestamptz,
  "cancel_deadline" timestamptz,
  "termination_deadline" timestamptz,
  "worker_self_deadline" timestamptz,
  "termination_confirmation_deadline" timestamptz,
  "provider_ttl_deadline" timestamptz,
  CONSTRAINT "foundry_attempt_execution_fk" FOREIGN KEY(
    "execution_id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_attempt_execution_subject_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "execution_subject_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_attempt_execution_ordinal_unique" UNIQUE("execution_id", "attempt_ordinal"),
  CONSTRAINT "foundry_attempt_execution_fence_unique" UNIQUE("execution_id", "fencing_token"),
  CONSTRAINT "foundry_attempt_actor_idempotency_unique" UNIQUE("created_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_attempt_scope_unique" UNIQUE(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ),
  CONSTRAINT "foundry_attempt_subject_unique" UNIQUE(
    "id", "execution_id", "execution_subject_sha256"
  ),
  CONSTRAINT "foundry_attempt_state" CHECK (
    "state" IN (
      'authorized', 'submit_pending', 'provider_unknown', 'queued', 'running',
      'checkpointing', 'stop_pending', 'terminating', 'termination_unconfirmed',
      'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled',
      'terminal_killed', 'terminal_budget_exceeded', 'terminal_validation_failed',
      'terminal_provider_lost'
    )
  ),
  CONSTRAINT "foundry_attempt_counters" CHECK (
    "attempt_ordinal" > 0 AND "fencing_token" > 0
    AND "observed_cost_micro_usd" >= 0 AND "revision" >= 0
  ),
  CONSTRAINT "foundry_attempt_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_attempt_lease_coherence" CHECK (
    ("lease_owner" IS NULL) = ("lease_expires_at" IS NULL)
  ),
  CONSTRAINT "foundry_attempt_provider_refs" CHECK (
    "state" NOT IN ('queued', 'running', 'checkpointing', 'validating', 'terminal_succeeded')
    OR "provider_execution_ref" IS NOT NULL
  ),
  CONSTRAINT "foundry_attempt_terminal_time" CHECK (
    (left("state", 9) = 'terminal_') = ("finished_at" IS NOT NULL)
  ),
  CONSTRAINT "foundry_attempt_runtime_deadline_coherence" CHECK (
    ("submitted_at" IS NULL) = ("wall_clock_deadline" IS NULL)
    AND ("submitted_at" IS NULL) = ("cancel_deadline" IS NULL)
    AND ("submitted_at" IS NULL) = ("termination_deadline" IS NULL)
    AND ("submitted_at" IS NULL) = ("worker_self_deadline" IS NULL)
    AND ("submitted_at" IS NULL) = ("termination_confirmation_deadline" IS NULL)
    AND ("submitted_at" IS NULL) = ("provider_ttl_deadline" IS NULL)
    AND (
      "submitted_at" IS NULL OR (
        "submitted_at" < "wall_clock_deadline"
        AND "wall_clock_deadline" <= "cancel_deadline"
        AND "cancel_deadline" <= "termination_deadline"
        AND "termination_deadline" <= "worker_self_deadline"
        AND "worker_self_deadline" < "termination_confirmation_deadline"
        AND "termination_confirmation_deadline" <= "provider_ttl_deadline"
      )
    )
  ),
  CONSTRAINT "foundry_attempt_timestamps" CHECK (
    "created_at" <= "updated_at"
    AND ("submitted_at" IS NULL OR "submitted_at" >= "created_at")
    AND ("started_at" IS NULL OR ("submitted_at" IS NOT NULL AND "started_at" >= "submitted_at"))
    AND ("finished_at" IS NULL OR "finished_at" >= COALESCE("started_at", "submitted_at", "created_at"))
    AND ("lease_expires_at" IS NULL OR "lease_expires_at" > "updated_at")
  ),
  CONSTRAINT "foundry_attempt_text" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND ("lease_owner" IS NULL OR char_length(btrim("lease_owner")) BETWEEN 1 AND 160)
    AND ("provider_execution_ref" IS NULL
      OR "foundry_is_canonical_provider_reference"("provider_execution_ref"))
    AND ("provider_attempt_ref" IS NULL
      OR "foundry_is_canonical_provider_reference"("provider_attempt_ref"))
  )
);

CREATE UNIQUE INDEX "foundry_attempt_one_nonterminal_unique"
  ON "foundry_attempts"("execution_id")
  WHERE left("state", 9) <> 'terminal_';

CREATE TABLE "foundry_stop_intents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "reason_code" varchar(40) NOT NULL,
  "priority" integer NOT NULL,
  "target_terminal_state" varchar(40) NOT NULL,
  "source_kind" varchar(40) NOT NULL,
  "source_id" uuid NOT NULL,
  "source_digest" varchar(71) NOT NULL,
  "source_recorded_at" timestamptz NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_stop_intent_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_stop_intent_subject_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "execution_subject_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_stop_intent_actor_idempotency_unique" UNIQUE(
    "actor_key", "idempotency_key"
  ),
  CONSTRAINT "foundry_stop_intent_source_unique" UNIQUE(
    "attempt_id", "source_kind", "source_id"
  ),
  CONSTRAINT "foundry_stop_intent_exact_unique" UNIQUE(
    "id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ),
  CONSTRAINT "foundry_stop_intent_reason_mapping" CHECK (
    CASE "reason_code"
      WHEN 'operator_cancel' THEN
        "priority" = 200 AND "target_terminal_state" = 'terminal_cancelled'
        AND "source_kind" = 'operator_request'
      WHEN 'kill_global' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_provider' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_project' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_execution' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'kill_attempt' THEN
        "priority" = 500 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'kill_switch_event'
      WHEN 'rights_revoked' THEN
        "priority" = 450 AND "target_terminal_state" = 'terminal_killed'
        AND "source_kind" = 'rights_policy_revocation'
      WHEN 'cost_hard_stop' THEN
        "priority" = 400 AND "target_terminal_state" = 'terminal_budget_exceeded'
        AND "source_kind" = 'cost_observation'
      WHEN 'wall_clock_deadline' THEN
        "priority" = 300 AND "target_terminal_state" = 'terminal_cancelled'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'cancel_deadline' THEN
        "priority" = 325 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'termination_deadline' THEN
        "priority" = 350 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'worker_self_deadline' THEN
        "priority" = 375 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'provider_ttl_deadline' THEN
        "priority" = 425 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'runtime_watchdog'
      WHEN 'checkpoint_effect_unknown' THEN
        "priority" = 390 AND "target_terminal_state" = 'terminal_provider_lost'
        AND "source_kind" = 'provider_command'
      ELSE false
    END
  ),
  CONSTRAINT "foundry_stop_intent_actor" CHECK (
    "actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND (("actor_kind" = 'operator') = ("actor_user_id" IS NOT NULL))
    AND ("reason_code" <> 'operator_cancel' OR "actor_kind" = 'operator')
  ),
  CONSTRAINT "foundry_stop_intent_causation" CHECK (
    "causation_id" = "source_id" AND "id" <> "source_id"
  ),
  CONSTRAINT "foundry_stop_intent_digests" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "source_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_stop_intent_bounds" CHECK (
    "attempt_ordinal" > 0 AND "fencing_token" > 0
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND "source_recorded_at" <= "recorded_at"
  )
);

CREATE TABLE "foundry_prepared_provider_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "command_kind" varchar(40) NOT NULL,
  "provider_command_id" uuid NOT NULL,
  "command_sequence" bigint NOT NULL,
  "stop_intent_id" uuid,
  "provider_request_sha256" varchar(71) NOT NULL,
  "provider_request_json" jsonb NOT NULL,
  "provider_request_profile_id" varchar(120) NOT NULL,
  "provider_request_profile_version" varchar(120) NOT NULL,
  "provider_request_profile_sha256" varchar(71) NOT NULL,
  "provider_adapter_configuration_sha256" varchar(71) NOT NULL,
  "provider_idempotency_key" varchar(120) NOT NULL,
  "provider_client_request_id" varchar(120) NOT NULL,
  "stage_ids" jsonb NOT NULL,
  "maximum_api_call_seconds" integer NOT NULL,
  "prepared_by_actor_kind" varchar(30) NOT NULL,
  "prepared_by_actor_key" varchar(160) NOT NULL,
  "prepared_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "prepared_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_prepared_request_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_prepared_request_subject_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "execution_subject_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_prepared_request_stop_intent_fk" FOREIGN KEY(
    "stop_intent_id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) REFERENCES "foundry_stop_intents"(
    "id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_prepared_request_profile_fk" FOREIGN KEY(
    "provider_request_profile_sha256", "provider_request_profile_id",
    "provider_request_profile_version", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_adapter_configuration_sha256", "provider_deployment_sha256"
  ) REFERENCES "foundry_provider_request_profiles"(
    "provider_request_profile_sha256", "profile_id", "profile_version",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_adapter_configuration_sha256",
    "provider_deployment_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_prepared_request_actor_idem_unique" UNIQUE(
    "prepared_by_actor_key", "idempotency_key"
  ),
  CONSTRAINT "foundry_prepared_request_exact_unique" UNIQUE(
    "id", "provider_command_id", "execution_id", "attempt_id",
    "execution_subject_sha256", "command_sequence", "command_kind",
    "provider_request_sha256", "provider_request_profile_id",
    "provider_request_profile_version", "provider_request_profile_sha256",
    "provider_adapter_configuration_sha256",
    "provider_idempotency_key", "provider_client_request_id",
    "maximum_api_call_seconds", "prepared_by_actor_kind", "prepared_by_actor_key"
  ),
  CONSTRAINT "foundry_prepared_request_command_unique" UNIQUE("provider_command_id"),
  CONSTRAINT "foundry_prepared_request_attempt_sequence_unique" UNIQUE(
    "attempt_id", "command_sequence"
  ),
  CONSTRAINT "foundry_prepared_request_kind" CHECK (
    "command_kind" IN (
      'provider_submit', 'provider_reconcile', 'provider_poll', 'provider_checkpoint', 'provider_stop'
    )
  ),
  CONSTRAINT "foundry_prepared_request_stop_coherence" CHECK (
    ("command_kind" = 'provider_stop') = ("stop_intent_id" IS NOT NULL)
  ),
  CONSTRAINT "foundry_prepared_request_actor" CHECK (
    "prepared_by_actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("prepared_by_actor_key")
    AND (("prepared_by_actor_kind" = 'operator') = ("prepared_by_user_id" IS NOT NULL))
    AND (
      "prepared_by_actor_kind" <> 'operator'
      OR "prepared_by_actor_key" = "prepared_by_user_id"::text
    )
  ),
  CONSTRAINT "foundry_prepared_request_json" CHECK (
    jsonb_typeof("provider_request_json") = 'object'
    AND jsonb_typeof("stage_ids") = 'array'
    AND jsonb_array_length("stage_ids") BETWEEN 1 AND 1000
  ),
  CONSTRAINT "foundry_prepared_request_digests" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_configuration_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_prepared_request_bounds" CHECK (
    "attempt_ordinal" > 0 AND "fencing_token" > 0
    AND "command_sequence" BETWEEN 1 AND 9007199254740991
    AND "maximum_api_call_seconds" BETWEEN 1 AND 300
    AND "provider_idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_client_request_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_kill_switches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "scope" varchar(20) NOT NULL,
  "target_key" varchar(320) NOT NULL,
  "project_id" varchar(120),
  "execution_id" uuid,
  "attempt_id" uuid,
  "job_id" varchar(120),
  "execution_envelope_sha256" varchar(71),
  "provider_kind" varchar(40),
  "provider_adapter_id" varchar(120),
  "provider_adapter_version" varchar(120),
  "provider_adapter_artifact_sha256" varchar(71),
  "provider_deployment_sha256" varchar(71),
  "attempt_ordinal" integer,
  "fencing_token" bigint,
  "state" varchar(20) NOT NULL DEFAULT 'inactive',
  "reason" text NOT NULL,
  "last_changed_actor_kind" varchar(30) NOT NULL,
  "last_changed_actor_key" varchar(160) NOT NULL,
  "last_changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "revision" bigint NOT NULL DEFAULT 0,
  "created_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_kill_execution_fk" FOREIGN KEY(
    "execution_id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_kill_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_kill_actor_idempotency_unique" UNIQUE("created_by_user_id", "idempotency_key"),
  CONSTRAINT "foundry_kill_exact_scope_unique" UNIQUE("id", "scope", "target_key"),
  CONSTRAINT "foundry_kill_scope" CHECK ("scope" IN ('global', 'provider', 'project', 'execution', 'attempt')),
  CONSTRAINT "foundry_kill_state" CHECK ("state" IN ('inactive', 'active')),
  CONSTRAINT "foundry_kill_scope_coherence" CHECK (
    CASE "scope"
      WHEN 'global' THEN
        "project_id" IS NULL AND "execution_id" IS NULL AND "attempt_id" IS NULL
        AND "job_id" IS NULL AND "execution_envelope_sha256" IS NULL
        AND "provider_kind" IS NULL AND "provider_adapter_id" IS NULL
        AND "provider_adapter_version" IS NULL AND "provider_adapter_artifact_sha256" IS NULL
        AND "provider_deployment_sha256" IS NULL AND "attempt_ordinal" IS NULL
        AND "fencing_token" IS NULL AND "target_key" = 'global'
      WHEN 'provider' THEN
        "project_id" IS NULL AND "execution_id" IS NULL AND "attempt_id" IS NULL
        AND "job_id" IS NULL AND "execution_envelope_sha256" IS NULL
        AND "provider_kind" IS NOT NULL AND "provider_adapter_id" IS NOT NULL
        AND "provider_adapter_version" IS NOT NULL AND "provider_adapter_artifact_sha256" IS NULL
        AND "provider_deployment_sha256" IS NULL AND "attempt_ordinal" IS NULL
        AND "fencing_token" IS NULL
        AND "target_key" = 'provider:' || "provider_kind" || ':' || "provider_adapter_id" || ':' || "provider_adapter_version"
      WHEN 'project' THEN
        "project_id" IS NOT NULL AND "execution_id" IS NULL AND "attempt_id" IS NULL
        AND "job_id" IS NULL AND "execution_envelope_sha256" IS NULL
        AND "provider_kind" IS NULL AND "provider_adapter_id" IS NULL
        AND "provider_adapter_version" IS NULL AND "provider_adapter_artifact_sha256" IS NULL
        AND "provider_deployment_sha256" IS NULL AND "attempt_ordinal" IS NULL
        AND "fencing_token" IS NULL AND "target_key" = 'project:' || "project_id"
      WHEN 'execution' THEN
        "project_id" IS NOT NULL AND "execution_id" IS NOT NULL AND "attempt_id" IS NULL
        AND "job_id" IS NOT NULL AND "execution_envelope_sha256" IS NOT NULL
        AND "provider_kind" IS NOT NULL AND "provider_adapter_id" IS NOT NULL
        AND "provider_adapter_version" IS NOT NULL AND "provider_adapter_artifact_sha256" IS NOT NULL
        AND "provider_deployment_sha256" IS NOT NULL AND "attempt_ordinal" IS NULL
        AND "fencing_token" IS NULL AND "target_key" = 'execution:' || "execution_id"::text
      WHEN 'attempt' THEN
        "project_id" IS NOT NULL AND "execution_id" IS NOT NULL AND "attempt_id" IS NOT NULL
        AND "job_id" IS NOT NULL AND "execution_envelope_sha256" IS NOT NULL
        AND "provider_kind" IS NOT NULL AND "provider_adapter_id" IS NOT NULL
        AND "provider_adapter_version" IS NOT NULL AND "provider_adapter_artifact_sha256" IS NOT NULL
        AND "provider_deployment_sha256" IS NOT NULL AND "attempt_ordinal" IS NOT NULL
        AND "fencing_token" IS NOT NULL AND "target_key" = 'attempt:' || "attempt_id"::text
      ELSE false
    END
  ),
  CONSTRAINT "foundry_kill_digest_shapes" CHECK (
    ("execution_envelope_sha256" IS NULL OR "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND ("provider_adapter_artifact_sha256" IS NULL OR "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND ("provider_deployment_sha256" IS NULL OR "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_kill_projection" CHECK (
    "revision" >= 0 AND "created_at" <= "updated_at"
    AND "last_changed_actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("last_changed_actor_key")
    AND (("last_changed_actor_kind" = 'operator') = ("last_changed_by_user_id" IS NOT NULL))
    AND char_length(btrim("reason")) BETWEEN 10 AND 4000
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE UNIQUE INDEX "foundry_kill_one_global_unique"
  ON "foundry_kill_switches"("scope") WHERE "scope" = 'global';
CREATE UNIQUE INDEX "foundry_kill_one_provider_unique"
  ON "foundry_kill_switches"("provider_kind", "provider_adapter_id", "provider_adapter_version")
  WHERE "scope" = 'provider';
CREATE UNIQUE INDEX "foundry_kill_one_project_unique"
  ON "foundry_kill_switches"("project_id") WHERE "scope" = 'project';
CREATE UNIQUE INDEX "foundry_kill_one_execution_unique"
  ON "foundry_kill_switches"("execution_id") WHERE "scope" = 'execution';
CREATE UNIQUE INDEX "foundry_kill_one_attempt_unique"
  ON "foundry_kill_switches"("attempt_id") WHERE "scope" = 'attempt';
CREATE INDEX "foundry_kill_active_scope_idx"
  ON "foundry_kill_switches"("state", "scope", "target_key");

CREATE TABLE "foundry_kill_switch_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kill_switch_id" uuid NOT NULL,
  "scope" varchar(20) NOT NULL,
  "target_key" varchar(320) NOT NULL,
  "sequence" bigint NOT NULL,
  "action" varchar(20) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid,
  "correlation_id" uuid NOT NULL,
  "expected_revision" bigint NOT NULL,
  "resulting_revision" bigint NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "reason" text NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_kill_event_switch_fk" FOREIGN KEY("kill_switch_id", "scope", "target_key")
    REFERENCES "foundry_kill_switches"("id", "scope", "target_key") ON DELETE RESTRICT,
  CONSTRAINT "foundry_kill_event_sequence_unique" UNIQUE("kill_switch_id", "sequence"),
  CONSTRAINT "foundry_kill_event_actor_idempotency_unique" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "foundry_kill_event_action" CHECK ("action" IN ('activate', 'release')),
  CONSTRAINT "foundry_kill_event_actor" CHECK (
    "actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND (("actor_kind" = 'operator') = ("actor_user_id" IS NOT NULL))
  ),
  CONSTRAINT "foundry_kill_event_revision" CHECK (
    "sequence" > 0 AND "expected_revision" >= 0
    AND "resulting_revision" = "expected_revision" + 1
  ),
  CONSTRAINT "foundry_kill_event_digest_shape" CHECK ("request_digest" ~ '^sha256:[a-f0-9]{64}$'),
  CONSTRAINT "foundry_kill_event_text" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND char_length(btrim("reason")) BETWEEN 10 AND 4000
  )
);

CREATE TABLE "foundry_execution_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid,
  "attempt_ordinal" integer,
  "fencing_token" bigint,
  "provider_command_id" uuid,
  "provider_command_kind" varchar(40),
  "claim_token" uuid,
  "provider_command_payload_sha256" varchar(71),
  "provider_request_sha256" varchar(71),
  "provider_idempotency_key" varchar(120),
  "maximum_api_call_seconds" integer,
  "provider_command_state" varchar(20),
  "provider_command_outcome_sha256" varchar(71),
  "provider_lifecycle_state" varchar(30),
  "provider_was_invoked" boolean,
  "sequence" bigint NOT NULL,
  "event_kind" varchar(60) NOT NULL,
  "advances_projection" boolean NOT NULL,
  "payload" jsonb NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid,
  "correlation_id" uuid NOT NULL,
  "expected_revision" bigint NOT NULL,
  "resulting_revision" bigint NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_event_execution_fk" FOREIGN KEY(
    "execution_id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "project_id", "job_id", "execution_envelope_sha256", "provider_kind",
    "provider_adapter_id", "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_event_execution_subject_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "execution_subject_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_event_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_event_execution_sequence_unique" UNIQUE("execution_id", "sequence"),
  CONSTRAINT "foundry_event_actor_idempotency_unique" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "foundry_event_attempt_coherence" CHECK (
    ("attempt_id" IS NULL) = ("attempt_ordinal" IS NULL)
    AND ("attempt_id" IS NULL) = ("fencing_token" IS NULL)
  ),
  CONSTRAINT "foundry_event_invocation_coherence" CHECK (
    ("event_kind" IN (
      'provider_command_transitioned', 'provider_invocation_started',
      'provider_command_completed'
    ))
      = ("provider_command_id" IS NOT NULL)
    AND ("provider_command_id" IS NULL) = ("provider_command_kind" IS NULL)
    AND ("provider_command_id" IS NULL) = ("provider_command_payload_sha256" IS NULL)
    AND ("provider_command_id" IS NULL) = ("provider_request_sha256" IS NULL)
    AND ("provider_command_id" IS NULL) = ("provider_idempotency_key" IS NULL)
    AND ("provider_command_id" IS NULL) = ("maximum_api_call_seconds" IS NULL)
    AND ("provider_command_id" IS NULL OR "causation_id" = "provider_command_id")
    AND CASE "event_kind"
      WHEN 'provider_command_transitioned' THEN
        "provider_command_state" IN ('pending', 'claimed', 'cancelled')
        AND CASE "payload"->>'transitionKind'
          WHEN 'enqueued' THEN "provider_command_state" = 'pending' AND "claim_token" IS NULL
          WHEN 'claimed' THEN "provider_command_state" = 'claimed' AND "claim_token" IS NOT NULL
          WHEN 'claim_released' THEN "provider_command_state" = 'pending' AND "claim_token" IS NOT NULL
          WHEN 'cancelled' THEN "provider_command_state" = 'cancelled' AND "claim_token" IS NULL
          ELSE false
        END
        AND "provider_command_outcome_sha256" IS NULL
        AND "provider_lifecycle_state" IS NULL
        AND "provider_was_invoked" IS NULL
      WHEN 'provider_invocation_started' THEN
        "claim_token" IS NOT NULL
        AND "provider_command_state" IS NULL
        AND "provider_command_outcome_sha256" IS NULL
        AND "provider_lifecycle_state" IS NULL
        AND "provider_was_invoked" IS NULL
      WHEN 'provider_command_completed' THEN
        "claim_token" IS NOT NULL
        AND "provider_command_state" IN ('succeeded', 'failed', 'uncertain')
        AND "provider_command_outcome_sha256" IS NOT NULL
        AND "provider_lifecycle_state" IS NOT NULL
        AND "provider_was_invoked" IS NOT NULL
      ELSE
        "claim_token" IS NULL
        AND "provider_command_state" IS NULL
        AND "provider_command_outcome_sha256" IS NULL
        AND "provider_lifecycle_state" IS NULL
        AND "provider_was_invoked" IS NULL
    END
  ),
  CONSTRAINT "foundry_event_sequence_revision" CHECK (
    "sequence" > 0 AND "expected_revision" >= 0 AND (
      (
        "event_kind" = 'execution_admitted'
        AND "sequence" = 1
        AND NOT "advances_projection"
        AND "expected_revision" = 0
        AND "resulting_revision" = 0
        AND "attempt_id" IS NULL
        AND "provider_command_id" IS NULL
      )
      OR (
        "event_kind" <> 'execution_admitted'
        AND "resulting_revision" = "expected_revision"
          + CASE WHEN "advances_projection" THEN 1 ELSE 0 END
      )
    )
  ),
  CONSTRAINT "foundry_event_invocation_is_audit_only" CHECK (
    "event_kind" <> 'provider_invocation_started' OR NOT "advances_projection"
  ),
  CONSTRAINT "foundry_event_actor" CHECK (
    "actor_kind" IN ('operator', 'service', 'provider', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND (("actor_kind" = 'operator') = ("actor_user_id" IS NOT NULL))
  ),
  CONSTRAINT "foundry_event_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
  CONSTRAINT "foundry_event_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND ("provider_command_payload_sha256" IS NULL
      OR "provider_command_payload_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND ("provider_request_sha256" IS NULL
      OR "provider_request_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND ("provider_command_outcome_sha256" IS NULL
      OR "provider_command_outcome_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_event_text" CHECK (
    "event_kind" ~ '^[a-z][a-z0-9_]{0,59}$'
    AND ("provider_command_kind" IS NULL OR "provider_command_kind" IN (
      'provider_submit', 'provider_reconcile', 'provider_poll', 'provider_checkpoint', 'provider_stop'
    ))
    AND ("provider_idempotency_key" IS NULL
      OR "provider_idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$')
    AND ("maximum_api_call_seconds" IS NULL
      OR "maximum_api_call_seconds" BETWEEN 1 AND 300)
    AND ("provider_command_state" IS NULL OR "provider_command_state" IN (
      'pending', 'claimed', 'succeeded', 'failed', 'uncertain', 'cancelled'
    ))
    AND ("provider_lifecycle_state" IS NULL OR "provider_lifecycle_state" IN (
      'not_observed', 'unknown', 'queued', 'running', 'exited', 'terminated', 'not_found'
    ))
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_provider_commands" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "command_sequence" bigint NOT NULL,
  "command_kind" varchar(40) NOT NULL,
  "prepared_provider_request_id" uuid NOT NULL,
  "stop_intent_id" uuid,
  "cancelled_by_stop_intent_id" uuid,
  "cancelled_by_provider_command_id" uuid,
  "state" varchar(20) NOT NULL DEFAULT 'pending',
  "payload" jsonb NOT NULL,
  "payload_sha256" varchar(71) NOT NULL,
  "provider_request_sha256" varchar(71) NOT NULL,
  "provider_request_profile_id" varchar(120) NOT NULL,
  "provider_request_profile_version" varchar(120) NOT NULL,
  "provider_request_profile_sha256" varchar(71) NOT NULL,
  "provider_adapter_configuration_sha256" varchar(71) NOT NULL,
  "provider_idempotency_key" varchar(120) NOT NULL,
  "provider_client_request_id" varchar(120) NOT NULL,
  "stage_ids" jsonb NOT NULL,
  "maximum_api_call_seconds" integer NOT NULL,
  "target_provider_ref" varchar(240),
  "originating_submit_command_id" uuid,
  "originating_submit_provider_request_sha256" varchar(71),
  "originating_submit_provider_idempotency_key" varchar(120),
  "provider_command_ref" varchar(240),
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "claimed_by" varchar(160),
  "claim_token" uuid,
  "claimed_at" timestamptz,
  "claim_expires_at" timestamptz,
  "outcome_json" jsonb,
  "outcome_sha256" varchar(71),
  "provider_lifecycle_state" varchar(30),
  "completed_by_actor_kind" varchar(30),
  "completed_by_actor_key" varchar(160),
  "completed_at" timestamptz,
  "created_by_actor_kind" varchar(30) NOT NULL,
  "created_by_actor_key" varchar(160) NOT NULL,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE RESTRICT,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "revision" bigint NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_command_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_command_execution_subject_fk" FOREIGN KEY(
    "execution_id", "execution_subject_sha256"
  ) REFERENCES "foundry_executions"(
    "id", "execution_subject_sha256"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_command_stop_intent_fk" FOREIGN KEY(
    "stop_intent_id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) REFERENCES "foundry_stop_intents"(
    "id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_command_cancelled_stop_intent_fk" FOREIGN KEY(
    "cancelled_by_stop_intent_id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) REFERENCES "foundry_stop_intents"(
    "id", "execution_id", "attempt_id", "execution_subject_sha256", "fencing_token"
  ) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "foundry_command_prepared_request_fk" FOREIGN KEY(
    "prepared_provider_request_id", "id", "execution_id", "attempt_id",
    "execution_subject_sha256", "command_sequence", "command_kind",
    "provider_request_sha256", "provider_request_profile_id",
    "provider_request_profile_version", "provider_request_profile_sha256",
    "provider_adapter_configuration_sha256",
    "provider_idempotency_key", "provider_client_request_id", "maximum_api_call_seconds",
    "created_by_actor_kind", "created_by_actor_key"
  ) REFERENCES "foundry_prepared_provider_requests"(
    "id", "provider_command_id", "execution_id", "attempt_id",
    "execution_subject_sha256", "command_sequence", "command_kind",
    "provider_request_sha256", "provider_request_profile_id",
    "provider_request_profile_version", "provider_request_profile_sha256",
    "provider_adapter_configuration_sha256",
    "provider_idempotency_key", "provider_client_request_id", "maximum_api_call_seconds",
    "prepared_by_actor_kind", "prepared_by_actor_key"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_command_attempt_sequence_unique" UNIQUE("attempt_id", "command_sequence"),
  CONSTRAINT "foundry_command_actor_idempotency_unique" UNIQUE("created_by_actor_key", "idempotency_key"),
  CONSTRAINT "foundry_command_kind" CHECK (
    "command_kind" IN ('provider_submit', 'provider_reconcile', 'provider_poll', 'provider_checkpoint', 'provider_stop')
  ),
  CONSTRAINT "foundry_command_state" CHECK (
    "state" IN ('pending', 'claimed', 'succeeded', 'failed', 'uncertain', 'cancelled')
  ),
  CONSTRAINT "foundry_command_counters" CHECK (
    "attempt_ordinal" > 0 AND "fencing_token" > 0
    AND "command_sequence" BETWEEN 1 AND 9007199254740991
    AND "revision" >= 0
  ),
  CONSTRAINT "foundry_command_claim_coherence" CHECK (
    CASE "state"
      WHEN 'pending' THEN
        "claimed_by" IS NULL AND "claim_token" IS NULL AND "claimed_at" IS NULL
        AND "claim_expires_at" IS NULL AND "outcome_json" IS NULL
        AND "outcome_sha256" IS NULL AND "provider_lifecycle_state" IS NULL
        AND "completed_by_actor_kind" IS NULL AND "completed_by_actor_key" IS NULL
        AND "completed_at" IS NULL AND "provider_command_ref" IS NULL
        AND "cancelled_by_stop_intent_id" IS NULL
        AND "cancelled_by_provider_command_id" IS NULL
      WHEN 'claimed' THEN
        "claimed_by" IS NOT NULL AND "claim_token" IS NOT NULL AND "claimed_at" IS NOT NULL
        AND "claim_expires_at" IS NOT NULL AND "outcome_json" IS NULL
        AND "outcome_sha256" IS NULL AND "provider_lifecycle_state" IS NULL
        AND "completed_by_actor_kind" IS NULL AND "completed_by_actor_key" IS NULL
        AND "completed_at" IS NULL AND "provider_command_ref" IS NULL
        AND "cancelled_by_stop_intent_id" IS NULL
        AND "cancelled_by_provider_command_id" IS NULL
      WHEN 'cancelled' THEN
        "claimed_by" IS NULL AND "claim_token" IS NULL AND "claimed_at" IS NULL
        AND "claim_expires_at" IS NULL AND "outcome_json" IS NULL
        AND "outcome_sha256" IS NULL AND "provider_lifecycle_state" IS NULL
        AND "completed_by_actor_kind" IS NULL AND "completed_by_actor_key" IS NULL
        AND "completed_at" IS NOT NULL AND "provider_command_ref" IS NULL
        AND num_nonnulls(
          "cancelled_by_stop_intent_id", "cancelled_by_provider_command_id"
        ) = 1
      ELSE
        "claimed_by" IS NOT NULL AND "claim_token" IS NOT NULL AND "claimed_at" IS NOT NULL
        AND "claim_expires_at" IS NOT NULL AND "outcome_json" IS NOT NULL
        AND "outcome_sha256" IS NOT NULL AND "provider_lifecycle_state" IS NOT NULL
        AND "completed_by_actor_kind" IS NOT NULL AND "completed_by_actor_key" IS NOT NULL
        AND "completed_at" IS NOT NULL
        AND "cancelled_by_stop_intent_id" IS NULL
        AND "cancelled_by_provider_command_id" IS NULL
    END
  ),
  CONSTRAINT "foundry_command_outcome_coherence" CHECK (
    CASE WHEN "state" IN ('succeeded', 'failed', 'uncertain') THEN
      jsonb_typeof("outcome_json") = 'object'
      AND "foundry_jsonb_object_key_count"("outcome_json") = 12
      AND "outcome_json" ?& ARRAY[
        'schemaVersion', 'commandId', 'executionId', 'attemptId', 'claimToken',
        'fencingToken', 'status', 'outcomeCode', 'providerLifecycle',
        'providerCommandRef', 'evidenceSha256', 'completedBy'
      ]
      AND jsonb_typeof("outcome_json"->'schemaVersion') = 'string'
      AND jsonb_typeof("outcome_json"->'commandId') = 'string'
      AND jsonb_typeof("outcome_json"->'executionId') = 'string'
      AND jsonb_typeof("outcome_json"->'attemptId') = 'string'
      AND jsonb_typeof("outcome_json"->'claimToken') = 'string'
      AND jsonb_typeof("outcome_json"->'fencingToken') = 'string'
      AND jsonb_typeof("outcome_json"->'status') = 'string'
      AND jsonb_typeof("outcome_json"->'outcomeCode') = 'string'
      AND jsonb_typeof("outcome_json"->'providerLifecycle') = 'string'
      AND jsonb_typeof("outcome_json"->'providerCommandRef') IN ('null', 'string')
      AND jsonb_typeof("outcome_json"->'evidenceSha256') = 'string'
      AND jsonb_typeof("outcome_json"->'completedBy') = 'object'
      AND "foundry_jsonb_object_key_count"("outcome_json"->'completedBy') = 2
      AND "outcome_json"->'completedBy' ?& ARRAY['actorKind', 'actorKey']
      AND jsonb_typeof("outcome_json"->'completedBy'->'actorKind') = 'string'
      AND jsonb_typeof("outcome_json"->'completedBy'->'actorKey') = 'string'
      AND "outcome_json"->>'schemaVersion'
        IS NOT DISTINCT FROM 'omnitwin.foundry.provider-command-outcome.v0'
      AND "outcome_json"->>'commandId' IS NOT DISTINCT FROM "id"::text
      AND "outcome_json"->>'executionId' IS NOT DISTINCT FROM "execution_id"::text
      AND "outcome_json"->>'attemptId' IS NOT DISTINCT FROM "attempt_id"::text
      AND "outcome_json"->>'claimToken' IS NOT DISTINCT FROM "claim_token"::text
      AND "outcome_json"->>'fencingToken' IS NOT DISTINCT FROM "fencing_token"::text
      AND "outcome_json"->>'status' IS NOT DISTINCT FROM "state"
      AND "outcome_json"->>'providerLifecycle'
        IS NOT DISTINCT FROM "provider_lifecycle_state"
      AND "outcome_json"->>'providerCommandRef'
        IS NOT DISTINCT FROM "provider_command_ref"
      AND "outcome_json"->'completedBy'->>'actorKind'
        IS NOT DISTINCT FROM "completed_by_actor_kind"
      AND "outcome_json"->'completedBy'->>'actorKey'
        IS NOT DISTINCT FROM "completed_by_actor_key"
      AND "outcome_json"->>'evidenceSha256' ~ '^sha256:[a-f0-9]{64}$'
      AND "outcome_json"->>'outcomeCode' ~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
    ELSE "outcome_json" IS NULL END
  ),
  CONSTRAINT "foundry_command_outcome_matrix" CHECK (
    CASE
      WHEN "state" = 'uncertain' THEN
        "provider_lifecycle_state" = 'unknown'
        AND (
          "command_kind" = 'provider_submit'
          OR "provider_command_ref" IS NOT DISTINCT FROM "target_provider_ref"
        )
      WHEN "command_kind" = 'provider_submit' AND "state" = 'succeeded' THEN
        "provider_lifecycle_state" IN ('queued', 'running')
        AND "provider_command_ref" IS NOT NULL
      WHEN "command_kind" = 'provider_submit' AND "state" = 'failed' THEN
        "provider_lifecycle_state" = 'not_observed'
        AND "provider_command_ref" IS NULL
      WHEN "command_kind" = 'provider_reconcile' AND "state" = 'succeeded' THEN
        ((
          "provider_lifecycle_state" = 'not_found' AND "provider_command_ref" IS NULL
        ) OR (
          "provider_lifecycle_state" IN ('queued', 'running', 'exited', 'terminated')
          AND "provider_command_ref" IS NOT NULL
        )) AND (
          "target_provider_ref" IS NULL
          OR "provider_lifecycle_state" = 'not_found'
          OR "provider_command_ref" = "target_provider_ref"
        )
      WHEN "command_kind" = 'provider_reconcile' AND "state" = 'failed' THEN
        "provider_lifecycle_state" = 'not_observed'
        AND "provider_command_ref" IS NOT DISTINCT FROM "target_provider_ref"
      WHEN "command_kind" = 'provider_poll' AND "state" = 'succeeded' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('queued', 'running', 'exited', 'terminated')
      WHEN "command_kind" = 'provider_poll' AND "state" = 'failed' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('not_observed', 'not_found')
      WHEN "command_kind" = 'provider_checkpoint' AND "state" = 'succeeded' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('running', 'exited', 'terminated')
      WHEN "command_kind" = 'provider_checkpoint' AND "state" = 'failed' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('not_observed', 'not_found')
      WHEN "command_kind" = 'provider_stop' AND "state" = 'succeeded' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('exited', 'terminated', 'not_found')
      WHEN "command_kind" = 'provider_stop' AND "state" = 'failed' THEN
        "provider_command_ref" IS NOT NULL
        AND "provider_command_ref" = "target_provider_ref"
        AND "provider_lifecycle_state" IN ('not_observed', 'not_found')
      ELSE "state" IN ('pending', 'claimed', 'cancelled')
    END
  ),
  CONSTRAINT "foundry_command_lineage_coherence" CHECK (
    CASE "command_kind"
      WHEN 'provider_submit' THEN
        "target_provider_ref" IS NULL
        AND "stop_intent_id" IS NULL
        AND "originating_submit_command_id" IS NULL
        AND "originating_submit_provider_request_sha256" IS NULL
        AND "originating_submit_provider_idempotency_key" IS NULL
      WHEN 'provider_reconcile' THEN
        "stop_intent_id" IS NULL
        AND "originating_submit_command_id" IS NOT NULL
        AND "originating_submit_provider_request_sha256" IS NOT NULL
        AND "originating_submit_provider_idempotency_key" IS NOT NULL
      WHEN 'provider_stop' THEN
        "target_provider_ref" IS NOT NULL
        AND "stop_intent_id" IS NOT NULL
        AND "causation_id" = "stop_intent_id"
        AND "originating_submit_command_id" IS NULL
        AND "originating_submit_provider_request_sha256" IS NULL
        AND "originating_submit_provider_idempotency_key" IS NULL
      ELSE
        "target_provider_ref" IS NOT NULL
        AND "stop_intent_id" IS NULL
        AND "originating_submit_command_id" IS NULL
        AND "originating_submit_provider_request_sha256" IS NULL
        AND "originating_submit_provider_idempotency_key" IS NULL
    END
  ),
  CONSTRAINT "foundry_command_provider_lifecycle_state" CHECK (
    "provider_lifecycle_state" IS NULL OR "provider_lifecycle_state" IN (
      'not_observed', 'unknown', 'queued', 'running', 'exited', 'terminated', 'not_found'
    )
  ),
  CONSTRAINT "foundry_command_completion_actor" CHECK (
    ("completed_by_actor_kind" IS NULL) = ("completed_by_actor_key" IS NULL)
    AND (
      "completed_by_actor_kind" IS NULL OR (
        "completed_by_actor_kind" IN ('service', 'watchdog', 'system')
        AND "foundry_is_canonical_actor"("completed_by_actor_key")
      )
    )
  ),
  CONSTRAINT "foundry_command_creator_actor" CHECK (
    "created_by_actor_kind" IN ('operator', 'service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("created_by_actor_key")
    AND (("created_by_actor_kind" = 'operator') = ("created_by_user_id" IS NOT NULL))
    AND (
      "created_by_actor_kind" <> 'operator'
      OR "created_by_actor_key" = "created_by_user_id"::text
    )
  ),
  CONSTRAINT "foundry_command_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "payload_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_configuration_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND ("originating_submit_provider_request_sha256" IS NULL
      OR "originating_submit_provider_request_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND ("outcome_sha256" IS NULL OR "outcome_sha256" ~ '^sha256:[a-f0-9]{64}$')
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_command_payload_object" CHECK (
    jsonb_typeof("payload") = 'object'
    AND "foundry_jsonb_object_key_count"("payload") = 10
    AND "payload" ?& ARRAY[
      'commandKind', 'executionSubjectSha256', 'providerRequest',
      'providerRequestSha256', 'providerIdempotencyKey', 'stageIds',
      'maximumApiCallSeconds', 'providerCommandRef', 'submitLineage', 'stopIntentId'
    ]
    AND jsonb_typeof("payload"->'providerRequest') = 'object'
    AND jsonb_typeof("payload"->'providerIdempotencyKey') = 'string'
    AND jsonb_typeof("payload"->'stageIds') = 'array'
    AND jsonb_typeof("payload"->'maximumApiCallSeconds') = 'number'
    AND jsonb_typeof("payload"->'providerCommandRef') IN ('null', 'string')
    AND jsonb_typeof("payload"->'submitLineage') IN ('null', 'object')
    AND jsonb_typeof("payload"->'stopIntentId') IN ('null', 'string')
    AND jsonb_typeof("stage_ids") = 'array'
    AND jsonb_array_length("stage_ids") BETWEEN 1 AND 1000
    AND "payload"->'stageIds' IS NOT DISTINCT FROM "stage_ids"
    AND "payload"->>'commandKind' IS NOT DISTINCT FROM "command_kind"
    AND "payload"->>'executionSubjectSha256' IS NOT DISTINCT FROM "execution_subject_sha256"
    AND "payload"->>'providerRequestSha256' IS NOT DISTINCT FROM "provider_request_sha256"
    AND "payload"->>'providerIdempotencyKey' IS NOT DISTINCT FROM "provider_idempotency_key"
    AND ("payload"->'maximumApiCallSeconds' #>> '{}')::numeric
      IS NOT DISTINCT FROM "maximum_api_call_seconds"::numeric
    AND "payload"->>'providerCommandRef' IS NOT DISTINCT FROM "target_provider_ref"
    AND "payload"->>'stopIntentId' IS NOT DISTINCT FROM "stop_intent_id"::text
  ),
  CONSTRAINT "foundry_command_api_call_bounds" CHECK (
    "maximum_api_call_seconds" BETWEEN 1 AND 300
  ),
  CONSTRAINT "foundry_command_timestamps" CHECK (
    "created_at" <= "updated_at" AND "created_at" <= "available_at"
    AND ("claimed_at" IS NULL OR "claimed_at" >= "available_at")
    AND ("claim_expires_at" IS NULL OR "claim_expires_at" > "claimed_at")
    AND ("completed_at" IS NULL OR "completed_at" >= "claimed_at")
  ),
  CONSTRAINT "foundry_command_text" CHECK (
    char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND "provider_idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_client_request_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND ("originating_submit_provider_idempotency_key" IS NULL
      OR "originating_submit_provider_idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$')
    AND ("claimed_by" IS NULL OR "foundry_is_canonical_actor"("claimed_by"))
    AND ("completed_by_actor_key" IS NULL
      OR char_length(btrim("completed_by_actor_key")) BETWEEN 1 AND 160)
    AND ("target_provider_ref" IS NULL
      OR "foundry_is_canonical_provider_reference"("target_provider_ref"))
    AND ("provider_command_ref" IS NULL
      OR "foundry_is_canonical_provider_reference"("provider_command_ref"))
    AND ("provider_command_ref" IS NULL OR (
      "provider_command_ref" = btrim("provider_command_ref")
      AND char_length("provider_command_ref") BETWEEN 1 AND 240
    ))
  )
);

ALTER TABLE "foundry_provider_commands"
  ADD CONSTRAINT "foundry_command_originating_submit_fk"
  FOREIGN KEY("originating_submit_command_id")
  REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT;
ALTER TABLE "foundry_provider_commands"
  ADD CONSTRAINT "foundry_command_cancelled_by_command_fk"
  FOREIGN KEY("cancelled_by_provider_command_id")
  REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX "foundry_command_one_active_kind_unique"
  ON "foundry_provider_commands"("attempt_id", "command_kind")
  WHERE "state" IN ('pending', 'claimed');
CREATE UNIQUE INDEX "foundry_command_one_active_non_stop_unique"
  ON "foundry_provider_commands"("attempt_id")
  WHERE "state" IN ('pending', 'claimed') AND "command_kind" <> 'provider_stop';
CREATE UNIQUE INDEX "foundry_command_submit_provider_idempotency_unique"
  ON "foundry_provider_commands"(
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_deployment_sha256", "provider_idempotency_key"
  ) WHERE "command_kind" = 'provider_submit';
CREATE INDEX "foundry_command_claimable_idx"
  ON "foundry_provider_commands"("state", "available_at", "claim_expires_at");

ALTER TABLE "foundry_execution_events"
  ADD CONSTRAINT "foundry_event_provider_command_fk"
  FOREIGN KEY("provider_command_id") REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT;
CREATE UNIQUE INDEX "foundry_event_one_invocation_start_unique"
  ON "foundry_execution_events"("provider_command_id", "claim_token")
  WHERE "event_kind" = 'provider_invocation_started';
CREATE UNIQUE INDEX "foundry_event_one_command_completion_unique"
  ON "foundry_execution_events"("provider_command_id")
  WHERE "event_kind" = 'provider_command_completed';

-- A conclusive adapter response is persisted before command completion is
-- attempted.  This is deliberately raw evidence only: it does not advance an
-- execution projection, append an execution event, or create checkpoint
-- authority.  The separate classification table below links an observation to
-- the exact terminal completion event once that event exists.
CREATE TABLE "foundry_provider_command_result_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "provider_command_id" uuid NOT NULL REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT,
  "invocation_event_id" uuid NOT NULL REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "execution_subject_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_adapter_configuration_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "prepared_provider_request_id" uuid NOT NULL REFERENCES "foundry_prepared_provider_requests"("id") ON DELETE RESTRICT,
  "provider_request_profile_id" varchar(120) NOT NULL,
  "provider_request_profile_version" varchar(120) NOT NULL,
  "provider_request_profile_sha256" varchar(71) NOT NULL,
  "provider_request_sha256" varchar(71) NOT NULL,
  "provider_idempotency_key" varchar(120) NOT NULL,
  "provider_client_request_id" varchar(120) NOT NULL,
  "maximum_api_call_seconds" integer NOT NULL,
  "command_payload_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "command_sequence" bigint NOT NULL,
  "command_kind" varchar(40) NOT NULL,
  "claim_token" uuid NOT NULL,
  "claimed_by" varchar(160) NOT NULL,
  "adapter_outcome_json" jsonb NOT NULL,
  "adapter_outcome_sha256" varchar(71) NOT NULL,
  "worker_observed_at" timestamptz NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_result_observation_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_result_observation_command_claim_unique" UNIQUE("provider_command_id", "claim_token"),
  CONSTRAINT "foundry_result_observation_invocation_unique" UNIQUE("invocation_event_id"),
  CONSTRAINT "foundry_result_observation_actor_idempotency_unique" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "foundry_result_observation_scope" CHECK (
    "attempt_ordinal" > 0
    AND "fencing_token" > 0
    AND "command_sequence" BETWEEN 1 AND 9007199254740991
    AND "command_kind" IN (
      'provider_submit', 'provider_reconcile', 'provider_poll', 'provider_checkpoint', 'provider_stop'
    )
    AND "actor_kind" = 'service'
    AND "actor_key" = "claimed_by"
    AND "foundry_is_canonical_actor"("claimed_by")
    AND "causation_id" = "invocation_event_id"
  ),
  CONSTRAINT "foundry_result_observation_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "execution_subject_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_configuration_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_profile_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_request_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "command_payload_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "adapter_outcome_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof("adapter_outcome_json") = 'object'
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND "idempotency_key" = btrim("idempotency_key")
    AND "provider_idempotency_key" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_client_request_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_id" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "provider_request_profile_version" ~ '^[a-z0-9][a-z0-9._-]{0,119}$'
    AND "maximum_api_call_seconds" BETWEEN 1 AND 300
    AND "recorded_at" >= "worker_observed_at" - interval '10 minutes'
  )
);

CREATE INDEX "foundry_result_observation_execution_recorded_idx"
  ON "foundry_provider_command_result_observations"("execution_id", "recorded_at" DESC);

CREATE TABLE "foundry_provider_command_result_classifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "observation_id" uuid NOT NULL REFERENCES "foundry_provider_command_result_observations"("id") ON DELETE RESTRICT,
  "provider_command_id" uuid NOT NULL REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT,
  "completion_event_id" uuid NOT NULL REFERENCES "foundry_execution_events"("id") ON DELETE RESTRICT,
  "terminal_outcome_sha256" varchar(71) NOT NULL,
  "disposition" varchar(30) NOT NULL,
  "actor_kind" varchar(30) NOT NULL,
  "actor_key" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "classified_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_result_classification_observation_unique" UNIQUE("observation_id"),
  CONSTRAINT "foundry_result_classification_command_unique" UNIQUE("provider_command_id"),
  CONSTRAINT "foundry_result_classification_completion_unique" UNIQUE("completion_event_id"),
  CONSTRAINT "foundry_result_classification_actor_idempotency_unique" UNIQUE("actor_key", "idempotency_key"),
  CONSTRAINT "foundry_result_classification_scope" CHECK (
    "disposition" IN ('late_eligible', 'already_authoritative', 'terminal_conflict', 'not_eligible')
    AND "actor_kind" IN ('service', 'watchdog', 'system')
    AND "foundry_is_canonical_actor"("actor_key")
    AND "causation_id" = "observation_id"
    AND "terminal_outcome_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND "idempotency_key" = btrim("idempotency_key")
  )
);

CREATE INDEX "foundry_result_classification_command_idx"
  ON "foundry_provider_command_result_classifications"("provider_command_id", "classified_at" DESC);

CREATE TABLE "foundry_cost_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "observation_sequence" bigint NOT NULL,
  "provider_observation_id" varchar(240) NOT NULL,
  "observation_kind" varchar(20) NOT NULL,
  "pricing_currency" char(3) NOT NULL,
  "pricing_snapshot_sha256" varchar(71) NOT NULL,
  "incremental_cost_micro_usd" bigint NOT NULL,
  "cumulative_cost_micro_usd" bigint NOT NULL,
  "evidence_sha256" varchar(71) NOT NULL,
  "provider_observed_at" timestamptz NOT NULL,
  "recorded_by" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "recorded_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_cost_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_cost_pricing_fk" FOREIGN KEY("execution_id", "pricing_currency", "pricing_snapshot_sha256")
    REFERENCES "foundry_executions"("id", "pricing_currency", "pricing_snapshot_sha256") ON DELETE RESTRICT,
  CONSTRAINT "foundry_cost_attempt_sequence_unique" UNIQUE("attempt_id", "observation_sequence"),
  CONSTRAINT "foundry_cost_provider_observation_unique" UNIQUE(
    "provider_kind", "provider_adapter_id", "provider_adapter_version", "provider_observation_id"
  ),
  CONSTRAINT "foundry_cost_actor_idempotency_unique" UNIQUE("recorded_by", "idempotency_key"),
  CONSTRAINT "foundry_cost_kind" CHECK ("observation_kind" IN ('accrued', 'final', 'adjustment')),
  CONSTRAINT "foundry_cost_currency" CHECK ("pricing_currency" = 'USD'),
  CONSTRAINT "foundry_cost_amounts" CHECK (
    "observation_sequence" > 0 AND "incremental_cost_micro_usd" >= 0
    AND "cumulative_cost_micro_usd" >= "incremental_cost_micro_usd"
  ),
  CONSTRAINT "foundry_cost_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "pricing_snapshot_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "evidence_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_cost_times" CHECK ("provider_observed_at" <= "recorded_at"),
  CONSTRAINT "foundry_cost_text" CHECK (
    char_length(btrim("provider_observation_id")) BETWEEN 1 AND 240
    AND "foundry_is_canonical_actor"("recorded_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
  )
);

CREATE TABLE "foundry_verified_checkpoints" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid NOT NULL,
  "project_id" varchar(120) NOT NULL,
  "job_id" varchar(120) NOT NULL,
  "execution_envelope_sha256" varchar(71) NOT NULL,
  "provider_kind" varchar(40) NOT NULL,
  "provider_adapter_id" varchar(120) NOT NULL,
  "provider_adapter_version" varchar(120) NOT NULL,
  "provider_adapter_artifact_sha256" varchar(71) NOT NULL,
  "provider_deployment_sha256" varchar(71) NOT NULL,
  "attempt_id" uuid NOT NULL,
  "attempt_ordinal" integer NOT NULL,
  "fencing_token" bigint NOT NULL,
  "provider_command_id" uuid NOT NULL REFERENCES "foundry_provider_commands"("id") ON DELETE RESTRICT,
  "provider_command_outcome_sha256" varchar(71) NOT NULL,
  "checkpoint_sequence" bigint NOT NULL,
  "checkpoint_kind" varchar(60) NOT NULL,
  "provider_checkpoint_id" varchar(240) NOT NULL,
  "checkpoint_sha256" varchar(71) NOT NULL,
  "evidence_ref" text NOT NULL,
  "provider_created_at" timestamptz NOT NULL,
  "verified_by" varchar(160) NOT NULL,
  "idempotency_key" varchar(160) NOT NULL,
  "causation_id" uuid NOT NULL,
  "correlation_id" uuid NOT NULL,
  "request_digest" varchar(71) NOT NULL,
  "verified_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "foundry_checkpoint_attempt_fk" FOREIGN KEY(
    "attempt_id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) REFERENCES "foundry_attempts"(
    "id", "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "provider_kind", "provider_adapter_id", "provider_adapter_version",
    "provider_adapter_artifact_sha256", "provider_deployment_sha256", "attempt_ordinal", "fencing_token"
  ) ON DELETE RESTRICT,
  CONSTRAINT "foundry_checkpoint_attempt_sequence_unique" UNIQUE("attempt_id", "checkpoint_sequence"),
  CONSTRAINT "foundry_checkpoint_command_unique" UNIQUE("provider_command_id"),
  CONSTRAINT "foundry_checkpoint_provider_dedupe_unique" UNIQUE(
    "attempt_id", "provider_checkpoint_id", "checkpoint_sha256"
  ),
  CONSTRAINT "foundry_checkpoint_actor_idempotency_unique" UNIQUE("verified_by", "idempotency_key"),
  CONSTRAINT "foundry_checkpoint_sequence" CHECK ("checkpoint_sequence" > 0),
  CONSTRAINT "foundry_checkpoint_command_lineage" CHECK ("causation_id" = "provider_command_id"),
  CONSTRAINT "foundry_checkpoint_digest_shapes" CHECK (
    "execution_envelope_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_adapter_artifact_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_deployment_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "provider_command_outcome_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "checkpoint_sha256" ~ '^sha256:[a-f0-9]{64}$'
    AND "request_digest" ~ '^sha256:[a-f0-9]{64}$'
  ),
  CONSTRAINT "foundry_checkpoint_times" CHECK (
    "provider_created_at" = date_trunc('milliseconds', "provider_created_at")
    AND "provider_created_at" <= "verified_at"
  ),
  CONSTRAINT "foundry_checkpoint_text" CHECK (
    "checkpoint_kind" ~ '^[a-z][a-z0-9_]{0,59}$'
    AND char_length(btrim("provider_checkpoint_id")) BETWEEN 1 AND 240
    AND "provider_checkpoint_id" = btrim("provider_checkpoint_id")
    AND char_length(btrim("evidence_ref")) BETWEEN 1 AND 2048
    AND "evidence_ref" = btrim("evidence_ref")
    AND char_length(btrim("verified_by")) BETWEEN 1 AND 160
    AND "foundry_is_canonical_actor"("verified_by")
    AND char_length(btrim("idempotency_key")) BETWEEN 1 AND 160
    AND "idempotency_key" = btrim("idempotency_key")
  )
);

CREATE FUNCTION "foundry_verified_checkpoint_evidence_sha256"(
  checkpoint_kind_input text,
  provider_checkpoint_id_input text,
  checkpoint_sha256_input text,
  evidence_ref_input text,
  provider_created_at_input timestamptz
)
RETURNS varchar(71)
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-checkpoint-evidence.v0',
    jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.provider-checkpoint-evidence.v0',
      'checkpointKind', checkpoint_kind_input,
      'providerCheckpointId', provider_checkpoint_id_input,
      'checkpointSha256', checkpoint_sha256_input,
      'evidenceRef', evidence_ref_input,
      'providerCreatedAt', to_char(
        date_trunc('milliseconds', provider_created_at_input AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
      )
    )
  )::varchar(71)
$$;

CREATE FUNCTION "foundry_provider_adapter_outcome_is_valid"(
  command_kind_input varchar,
  target_provider_ref_input varchar,
  outcome_input jsonb
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  outcome_status text;
  lifecycle text;
  provider_ref text;
  checkpoint jsonb;
  provider_created_at timestamptz;
BEGIN
  IF jsonb_typeof(outcome_input) IS DISTINCT FROM 'object'
     OR NOT (outcome_input ?& ARRAY[
       'status', 'outcomeCode', 'providerLifecycle', 'providerCommandRef', 'evidenceSha256'
     ])
     OR jsonb_typeof(outcome_input->'status') IS DISTINCT FROM 'string'
     OR jsonb_typeof(outcome_input->'outcomeCode') IS DISTINCT FROM 'string'
     OR jsonb_typeof(outcome_input->'providerLifecycle') IS DISTINCT FROM 'string'
     OR jsonb_typeof(outcome_input->'providerCommandRef') NOT IN ('null', 'string')
     OR jsonb_typeof(outcome_input->'evidenceSha256') IS DISTINCT FROM 'string'
     OR outcome_input->>'status' NOT IN ('succeeded', 'failed')
     OR outcome_input->>'outcomeCode' !~ '^[a-z0-9][a-z0-9._:-]{0,127}$'
     OR outcome_input->>'evidenceSha256' !~ '^sha256:[a-f0-9]{64}$' THEN
    RETURN false;
  END IF;
  outcome_status := outcome_input->>'status';
  lifecycle := outcome_input->>'providerLifecycle';
  provider_ref := outcome_input->>'providerCommandRef';
  IF provider_ref IS NOT NULL
     AND NOT "foundry_is_canonical_provider_reference"(provider_ref) THEN
    RETURN false;
  END IF;

  IF command_kind_input = 'provider_checkpoint' AND outcome_status = 'succeeded' THEN
    IF "foundry_jsonb_object_key_count"(outcome_input) <> 6
       OR NOT (outcome_input ? 'verifiedCheckpoint')
       OR jsonb_typeof(outcome_input->'verifiedCheckpoint') IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    checkpoint := outcome_input->'verifiedCheckpoint';
    IF "foundry_jsonb_object_key_count"(checkpoint) <> 6
       OR NOT (checkpoint ?& ARRAY[
         'schemaVersion', 'checkpointKind', 'checkpointSha256', 'evidenceRef',
         'providerCheckpointId', 'providerCreatedAt'
       ])
       OR checkpoint->>'schemaVersion' IS DISTINCT FROM
            'omnitwin.foundry.provider-checkpoint-evidence.v0'
       OR jsonb_typeof(checkpoint->'checkpointKind') IS DISTINCT FROM 'string'
       OR jsonb_typeof(checkpoint->'checkpointSha256') IS DISTINCT FROM 'string'
       OR jsonb_typeof(checkpoint->'evidenceRef') IS DISTINCT FROM 'string'
       OR jsonb_typeof(checkpoint->'providerCheckpointId') IS DISTINCT FROM 'string'
       OR jsonb_typeof(checkpoint->'providerCreatedAt') IS DISTINCT FROM 'string'
       OR checkpoint->>'checkpointKind' !~ '^[a-z][a-z0-9_]{0,59}$'
       OR checkpoint->>'checkpointSha256' !~ '^sha256:[a-f0-9]{64}$'
       OR checkpoint->>'evidenceRef' <> btrim(checkpoint->>'evidenceRef')
       OR char_length(checkpoint->>'evidenceRef') NOT BETWEEN 1 AND 2048
       OR checkpoint->>'providerCheckpointId' <>
            btrim(checkpoint->>'providerCheckpointId')
       OR char_length(checkpoint->>'providerCheckpointId') NOT BETWEEN 1 AND 240
       OR checkpoint->>'providerCreatedAt' !~
            '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}\+00:00$' THEN
      RETURN false;
    END IF;
    BEGIN
      provider_created_at := (checkpoint->>'providerCreatedAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN false;
    END;
    IF to_char(
         date_trunc('milliseconds', provider_created_at AT TIME ZONE 'UTC'),
         'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
       ) IS DISTINCT FROM checkpoint->>'providerCreatedAt'
       OR outcome_input->>'evidenceSha256' IS DISTINCT FROM
            "foundry_verified_checkpoint_evidence_sha256"(
              checkpoint->>'checkpointKind', checkpoint->>'providerCheckpointId',
              checkpoint->>'checkpointSha256', checkpoint->>'evidenceRef',
              provider_created_at
            ) THEN
      RETURN false;
    END IF;
  ELSIF "foundry_jsonb_object_key_count"(outcome_input) <> 5
        OR outcome_input ? 'verifiedCheckpoint' THEN
    RETURN false;
  END IF;

  RETURN CASE command_kind_input
    WHEN 'provider_submit' THEN CASE outcome_status
      WHEN 'succeeded' THEN lifecycle IN ('queued', 'running') AND provider_ref IS NOT NULL
      ELSE lifecycle = 'not_observed' AND provider_ref IS NULL
    END
    WHEN 'provider_reconcile' THEN CASE outcome_status
      WHEN 'succeeded' THEN (
        (lifecycle = 'not_found' AND provider_ref IS NULL)
        OR (
          lifecycle IN ('queued', 'running', 'exited', 'terminated')
          AND provider_ref IS NOT NULL
          AND (target_provider_ref_input IS NULL OR provider_ref = target_provider_ref_input)
        )
      )
      ELSE lifecycle = 'not_observed'
        AND provider_ref IS NOT DISTINCT FROM target_provider_ref_input
    END
    WHEN 'provider_poll' THEN
      provider_ref IS NOT NULL
      AND provider_ref = target_provider_ref_input AND CASE outcome_status
        WHEN 'succeeded' THEN lifecycle IN ('queued', 'running', 'exited', 'terminated')
        ELSE lifecycle IN ('not_observed', 'not_found')
      END
    WHEN 'provider_checkpoint' THEN
      provider_ref IS NOT NULL
      AND provider_ref = target_provider_ref_input AND CASE outcome_status
        WHEN 'succeeded' THEN lifecycle IN ('running', 'exited', 'terminated')
        ELSE lifecycle IN ('not_observed', 'not_found')
      END
    WHEN 'provider_stop' THEN
      provider_ref IS NOT NULL
      AND provider_ref = target_provider_ref_input AND CASE outcome_status
        WHEN 'succeeded' THEN lifecycle IN ('exited', 'terminated', 'not_found')
        ELSE lifecycle IN ('not_observed', 'not_found')
      END
    ELSE false
  END;
END;
$$;

CREATE FUNCTION "foundry_provider_result_observation_request_digest"(
  value_input "foundry_provider_command_result_observations"
)
RETURNS varchar(71)
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-command-result-observation.v0',
    jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.provider-command-result-observation.v0',
      'providerCommandId', value_input."provider_command_id"::text,
      'invocationEventId', value_input."invocation_event_id"::text,
      'executionId', value_input."execution_id"::text,
      'projectId', value_input."project_id",
      'jobId', value_input."job_id",
      'executionEnvelopeSha256', value_input."execution_envelope_sha256",
      'executionSubjectSha256', value_input."execution_subject_sha256",
      'providerKind', value_input."provider_kind",
      'providerAdapterId', value_input."provider_adapter_id",
      'providerAdapterVersion', value_input."provider_adapter_version",
      'providerAdapterArtifactSha256', value_input."provider_adapter_artifact_sha256",
      'providerAdapterConfigurationSha256', value_input."provider_adapter_configuration_sha256",
      'providerDeploymentSha256', value_input."provider_deployment_sha256",
      'preparedProviderRequestId', value_input."prepared_provider_request_id"::text,
      'providerRequestProfileId', value_input."provider_request_profile_id",
      'providerRequestProfileVersion', value_input."provider_request_profile_version",
      'providerRequestProfileSha256', value_input."provider_request_profile_sha256",
      'providerRequestSha256', value_input."provider_request_sha256",
      'providerIdempotencyKey', value_input."provider_idempotency_key",
      'providerClientRequestId', value_input."provider_client_request_id",
      'maximumApiCallSeconds', value_input."maximum_api_call_seconds",
      'commandPayloadSha256', value_input."command_payload_sha256",
      'attemptId', value_input."attempt_id"::text,
      'attemptOrdinal', value_input."attempt_ordinal",
      'fencingToken', value_input."fencing_token"::text,
      'commandSequence', value_input."command_sequence"::text,
      'commandKind', value_input."command_kind",
      'claimToken', value_input."claim_token"::text,
      'claimedBy', value_input."claimed_by",
      'adapterOutcome', value_input."adapter_outcome_json",
      'adapterOutcomeSha256', value_input."adapter_outcome_sha256",
      'workerObservedAt', to_char(
        date_trunc('milliseconds', value_input."worker_observed_at" AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
      ),
      'actorKind', value_input."actor_kind",
      'actorKey', value_input."actor_key",
      'idempotencyKey', value_input."idempotency_key",
      'causationId', value_input."causation_id"::text,
      'correlationId', value_input."correlation_id"::text,
      'recordedAt', to_char(
        date_trunc('milliseconds', value_input."recorded_at" AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
      )
    )
  )::varchar(71)
$$;

CREATE FUNCTION "foundry_provider_result_classification_request_digest"(
  value_input "foundry_provider_command_result_classifications"
)
RETURNS varchar(71)
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-command-result-classification.v0',
    jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.provider-command-result-classification.v0',
      'observationId', value_input."observation_id"::text,
      'providerCommandId', value_input."provider_command_id"::text,
      'completionEventId', value_input."completion_event_id"::text,
      'terminalOutcomeSha256', value_input."terminal_outcome_sha256",
      'disposition', value_input."disposition",
      'actorKind', value_input."actor_kind",
      'actorKey', value_input."actor_key",
      'idempotencyKey', value_input."idempotency_key",
      'causationId', value_input."causation_id"::text,
      'correlationId', value_input."correlation_id"::text,
      'classifiedAt', to_char(
        date_trunc('milliseconds', value_input."classified_at" AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
      )
    )
  )::varchar(71)
$$;

CREATE FUNCTION "foundry_verified_checkpoint_request_digest"(
  value_input "foundry_verified_checkpoints"
)
RETURNS varchar(71)
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.verified-checkpoint-record.v0',
    jsonb_build_object(
      'schemaVersion', 'omnitwin.foundry.verified-checkpoint-record.v0',
      'executionId', value_input."execution_id"::text,
      'projectId', value_input."project_id",
      'jobId', value_input."job_id",
      'executionEnvelopeSha256', value_input."execution_envelope_sha256",
      'providerKind', value_input."provider_kind",
      'providerAdapterId', value_input."provider_adapter_id",
      'providerAdapterVersion', value_input."provider_adapter_version",
      'providerAdapterArtifactSha256', value_input."provider_adapter_artifact_sha256",
      'providerDeploymentSha256', value_input."provider_deployment_sha256",
      'attemptId', value_input."attempt_id"::text,
      'attemptOrdinal', value_input."attempt_ordinal"::text,
      'fencingToken', value_input."fencing_token"::text,
      'providerCommandId', value_input."provider_command_id"::text,
      'providerCommandOutcomeSha256', value_input."provider_command_outcome_sha256",
      'checkpointSequence', value_input."checkpoint_sequence"::text,
      'checkpointKind', value_input."checkpoint_kind",
      'providerCheckpointId', value_input."provider_checkpoint_id",
      'checkpointSha256', value_input."checkpoint_sha256",
      'evidenceRef', value_input."evidence_ref",
      'providerCreatedAt', to_char(
        date_trunc('milliseconds', value_input."provider_created_at" AT TIME ZONE 'UTC'),
        'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
      ),
      'verifiedBy', value_input."verified_by",
      'idempotencyKey', value_input."idempotency_key",
      'causationId', value_input."causation_id"::text,
      'correlationId', value_input."correlation_id"::text
    )
  )::varchar(71)
$$;

CREATE INDEX "foundry_exec_project_state_idx" ON "foundry_executions"("project_id", "state", "updated_at" DESC);
CREATE INDEX "foundry_attempt_execution_state_idx" ON "foundry_attempts"("execution_id", "state", "updated_at" DESC);
CREATE INDEX "foundry_event_execution_recorded_idx" ON "foundry_execution_events"("execution_id", "recorded_at" DESC);
CREATE INDEX "foundry_cost_execution_recorded_idx" ON "foundry_cost_observations"("execution_id", "recorded_at" DESC);
CREATE INDEX "foundry_checkpoint_attempt_verified_idx" ON "foundry_verified_checkpoints"("attempt_id", "verified_at" DESC);

-- -----------------------------------------------------------------------------
-- Trigger enforcement. Immutable evidence rejects UPDATE, DELETE, and TRUNCATE.
-- Mutable projections/outbox rows allow guarded revision transitions but still
-- reject removal so their referenced evidence cannot be orphaned.
-- -----------------------------------------------------------------------------

CREATE FUNCTION "deny_foundry_append_only_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "deny_foundry_row_removal"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% rows cannot be removed', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION "lock_foundry_execution_control_root"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('foundry-kill:0:global', 0));
  RETURN NULL;
END;
$$;

CREATE FUNCTION "foundry_lock_execution_control_scopes"(
  provider_kind_input varchar,
  provider_adapter_id_input varchar,
  provider_adapter_version_input varchar,
  project_id_input varchar,
  execution_id_input uuid,
  attempt_id_input uuid
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- One deterministic order closes check/activate races for every kill scope.
  PERFORM pg_advisory_xact_lock(hashtextextended('foundry-kill:0:global', 0));
  IF provider_kind_input IS NOT NULL
     AND provider_adapter_id_input IS NOT NULL
     AND provider_adapter_version_input IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'foundry-kill:1:provider:' || provider_kind_input || ':'
        || provider_adapter_id_input || ':' || provider_adapter_version_input, 0
    ));
  END IF;
  IF project_id_input IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'foundry-kill:2:project:' || project_id_input, 0
    ));
  END IF;
  IF execution_id_input IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'foundry-kill:3:execution:' || execution_id_input::text, 0
    ));
  END IF;
  IF attempt_id_input IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'foundry-kill:4:attempt:' || attempt_id_input::text, 0
    ));
  END IF;
END;
$$;

CREATE FUNCTION "foundry_lock_rights_policy_version"(policy_version_input varchar)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- The global kill-scope lock is the transaction-wide predecessor for every
  -- policy and narrower kill-scope lock. This closes policy->scope versus
  -- scope->policy cycles in containment transactions.
  PERFORM pg_advisory_xact_lock(hashtextextended('foundry-kill:0:global', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'foundry-rights-policy-version:' || policy_version_input, 0
  ));
END;
$$;

CREATE FUNCTION "foundry_rights_policy_is_active"(
  policy_version_input varchar,
  policy_definition_sha256_input varchar,
  policy_generation_input bigint,
  at_input timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "foundry_rights_policy_versions" p
    WHERE p."policy_version" = policy_version_input
      AND p."policy_definition_sha256" = policy_definition_sha256_input
      AND p."generation" = policy_generation_input
      AND p."effective_at" <= at_input
      AND p."generation" = (
        SELECT max(current_policy."generation")
        FROM "foundry_rights_policy_versions" current_policy
        WHERE current_policy."policy_version" = p."policy_version"
          AND current_policy."effective_at" <= at_input
      )
      AND (p."revoked_at" IS NULL OR p."revoked_at" > at_input)
      AND NOT EXISTS (
        SELECT 1 FROM "foundry_rights_policy_revocations" r
        WHERE r."policy_version" = p."policy_version"
          AND r."policy_definition_sha256" = p."policy_definition_sha256"
          AND r."policy_generation" = p."generation"
          AND r."revoked_at" <= at_input
      )
  );
$$;

CREATE FUNCTION "foundry_execution_authority_is_current"(
  execution_id_input uuid,
  at_input timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "foundry_executions" e
    JOIN "foundry_jobs" j
      ON j."job_id" = e."job_id"
     AND j."project_id" = e."project_id"
    JOIN "foundry_rights_approvals" r ON r."id" = e."rights_approval_id"
    JOIN "foundry_execution_confirmations" c ON c."confirmation_id" = e."confirmation_id"
    LEFT JOIN "foundry_compute_approvals" a ON a."approval_id" = e."compute_approval_id"
    JOIN "foundry_provider_adapter_artifacts" aa
      ON aa."provider_adapter_artifact_sha256" = e."provider_adapter_artifact_sha256"
     AND aa."provider_kind" = e."provider_kind"
     AND aa."provider_adapter_id" = e."provider_adapter_id"
     AND aa."provider_adapter_version" = e."provider_adapter_version"
    JOIN "foundry_provider_deployments" d
      ON d."provider_deployment_sha256" = e."provider_deployment_sha256"
     AND d."provider_kind" = e."provider_kind"
     AND d."provider_adapter_id" = e."provider_adapter_id"
     AND d."provider_adapter_version" = e."provider_adapter_version"
     AND d."provider_adapter_artifact_sha256" = e."provider_adapter_artifact_sha256"
    WHERE e."id" = execution_id_input
      AND e."admitted_at" <= at_input
      AND at_input < e."dispatch_deadline"
      AND at_input < e."pricing_snapshot_expires_at"
      AND aa."reviewed_at" <= at_input
      AND aa."reviewed_at" <= j."provider_plan_planned_at"
      AND aa."registered_at" <= e."admitted_at"
      AND aa."expires_at" > at_input
      AND aa."expires_at" >= e."dispatch_deadline"
      AND d."observed_at" <= at_input
      AND d."observed_at" <= j."provider_plan_planned_at"
      AND d."registered_at" <= e."admitted_at"
      AND d."expires_at" > at_input
      AND d."expires_at" >= e."dispatch_deadline"
      AND r."job_id" = e."job_id"
      AND r."project_id" = e."project_id"
      AND r."execution_envelope_sha256" = e."execution_envelope_sha256"
      AND r."job_spec_sha256" = e."job_spec_sha256"
      AND r."reviewed_ingest_manifest_sha256" = e."reviewed_ingest_manifest_sha256"
      AND r."execution_policy_sha256" = e."execution_policy_sha256"
      AND r."policy_version" = e."rights_policy_version"
      AND r."policy_definition_sha256" = e."rights_policy_definition_sha256"
      AND r."policy_evidence_sha256" = e."rights_policy_evidence_sha256"
      AND r."policy_generation" = e."rights_policy_generation"
      AND r."rights_approval_sha256" = e."rights_approval_sha256"
      AND r."policy_maximum_approval_ttl_seconds" = e."rights_policy_maximum_approval_ttl_seconds"
      AND r."decision" = 'allowed'
      AND r."decided_at" <= at_input
      AND r."expires_at" > at_input
      AND c."job_id" = e."job_id"
      AND c."project_id" = e."project_id"
      AND c."execution_envelope_sha256" = e."execution_envelope_sha256"
      AND c."job_spec_sha256" = e."job_spec_sha256"
      AND c."confirmation_sha256" = e."confirmation_sha256"
      AND c."confirmed_at" <= at_input
      AND c."expires_at" > at_input
      AND (
        (e."provider_kind" IN ('local_cpu', 'local_cuda') AND e."compute_approval_id" IS NULL)
        OR (
          e."provider_kind" NOT IN ('local_cpu', 'local_cuda')
          AND a."job_id" = e."job_id"
          AND a."project_id" = e."project_id"
          AND a."execution_envelope_sha256" = e."execution_envelope_sha256"
          AND a."job_spec_sha256" = e."job_spec_sha256"
          AND a."provider_kind" = e."provider_kind"
          AND a."provider_adapter_id" = e."provider_adapter_id"
          AND a."provider_adapter_version" = e."provider_adapter_version"
          AND a."provider_adapter_artifact_sha256" = e."provider_adapter_artifact_sha256"
          AND a."provider_deployment_sha256" = e."provider_deployment_sha256"
          AND a."compute_approval_sha256" = e."compute_approval_sha256"
          AND a."approved_at" <= at_input
          AND a."expires_at" > at_input
          AND a."maximum_cost_micro_usd" >= e."absolute_cost_cap_micro_usd"
          AND a."maximum_cost_micro_usd" <= e."budget_cap_micro_usd"
        )
      )
      AND "foundry_rights_policy_is_active"(
        e."rights_policy_version", e."rights_policy_definition_sha256",
        e."rights_policy_generation", at_input
      )
      AND (
        SELECT count(DISTINCT jwp."worker_profile_sha256")
        FROM "foundry_job_worker_profiles" jwp
        WHERE jwp."job_id" = e."job_id"
          AND jwp."project_id" = e."project_id"
          AND jwp."execution_envelope_sha256" = e."execution_envelope_sha256"
          AND jwp."provider_plan_sha256" = e."provider_plan_sha256"
          AND jwp."trusted_worker_profile_set_sha256" = e."trusted_worker_profile_set_sha256"
      ) = e."trusted_worker_profile_count"
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_job_worker_profiles" jwp
        JOIN "foundry_trusted_worker_profiles" wp
          ON wp."worker_profile_sha256" = jwp."worker_profile_sha256"
         AND wp."operation_class" = jwp."operation_class"
        WHERE jwp."job_id" = e."job_id"
          AND jwp."project_id" = e."project_id"
          AND jwp."execution_envelope_sha256" = e."execution_envelope_sha256"
          AND jwp."provider_plan_sha256" = e."provider_plan_sha256"
          AND jwp."trusted_worker_profile_set_sha256" = e."trusted_worker_profile_set_sha256"
          AND (
            wp."reviewed_at" > j."provider_plan_planned_at"
            OR wp."registered_at" > e."admitted_at"
            OR jwp."registered_at" > e."admitted_at"
            OR wp."expires_at" < e."dispatch_deadline"
            OR wp."expires_at" <= at_input
            OR (e."provider_kind" IN ('local_cpu', 'local_cuda') AND NOT wp."local_execution_allowed")
          )
      )
  );
$$;

CREATE FUNCTION "guard_foundry_rights_policy_version"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_generation bigint;
  latest_effective_at timestamptz;
BEGIN
  NEW."registered_at" := clock_timestamp();
  PERFORM "foundry_lock_rights_policy_version"(NEW."policy_version");
  SELECT max(p."generation"), max(p."effective_at")
  INTO latest_generation, latest_effective_at
  FROM "foundry_rights_policy_versions" p
  WHERE p."policy_version" = NEW."policy_version";
  IF jsonb_typeof(NEW."policy_definition_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'rights-policy definition must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."policy_definition_json") <> 7
     OR NOT (NEW."policy_definition_json" ?& ARRAY[
       'schemaVersion', 'policyVersion', 'policyDefinitionSha256', 'generation',
       'effectiveAt', 'revokedAt', 'maximumApprovalTtlSeconds'
     ])
     OR jsonb_typeof(NEW."policy_definition_json"->'schemaVersion')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'policyVersion')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'policyDefinitionSha256')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'generation')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."policy_definition_json"->'effectiveAt')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."policy_definition_json"->'revokedAt')
          NOT IN ('null', 'string')
     OR jsonb_typeof(NEW."policy_definition_json"->'maximumApprovalTtlSeconds')
          IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'rights-policy definition must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF (NEW."policy_definition_json"->'generation' #>> '{}')::numeric
       <> trunc((NEW."policy_definition_json"->'generation' #>> '{}')::numeric)
     OR (NEW."policy_definition_json"->'generation' #>> '{}')::numeric
       NOT BETWEEN 1 AND 9007199254740991::numeric
     OR (NEW."policy_definition_json"->'maximumApprovalTtlSeconds' #>> '{}')::numeric
       <> trunc((NEW."policy_definition_json"->'maximumApprovalTtlSeconds' #>> '{}')::numeric)
     OR (NEW."policy_definition_json"->'maximumApprovalTtlSeconds' #>> '{}')::numeric
       NOT BETWEEN 1 AND 31536000::numeric THEN
    RAISE EXCEPTION 'rights-policy generation and approval TTL must be bounded integers'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."generation" <> COALESCE(latest_generation, 0) + 1
     OR (latest_effective_at IS NOT NULL AND NEW."effective_at" <= latest_effective_at)
     OR NEW."policy_definition_json"->>'schemaVersion'
          IS DISTINCT FROM 'omnitwin.foundry.rights-policy-definition.v0'
     OR NEW."policy_definition_json"->>'policyVersion' IS DISTINCT FROM NEW."policy_version"
     OR NEW."policy_definition_json"->>'policyDefinitionSha256'
          IS DISTINCT FROM NEW."policy_definition_sha256"
     OR (NEW."policy_definition_json"->'generation' #>> '{}')::numeric
          IS DISTINCT FROM NEW."generation"::numeric
     OR NEW."policy_definition_json"->>'effectiveAt' IS DISTINCT FROM to_char(
          NEW."effective_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        )
     OR (
       NEW."revoked_at" IS NULL
       AND NEW."policy_definition_json"->'revokedAt' IS DISTINCT FROM 'null'::jsonb
     )
     OR (
       NEW."revoked_at" IS NOT NULL
       AND NEW."policy_definition_json"->>'revokedAt' IS DISTINCT FROM to_char(
         NEW."revoked_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       )
     )
     OR (NEW."policy_definition_json"->'maximumApprovalTtlSeconds' #>> '{}')::numeric
          IS DISTINCT FROM NEW."maximum_approval_ttl_seconds"::numeric
     OR NEW."policy_evidence_sha256" IS DISTINCT FROM
          "foundry_domain_jsonb_sha256"(
            'omnitwin.foundry.rights-policy-definition.v0',
            NEW."policy_definition_json"
          ) THEN
    RAISE EXCEPTION 'rights-policy versions must be contiguous, forward-effective, and exact-evidence bound'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_rights_policy_revocation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  policy_effective_at timestamptz;
BEGIN
  NEW."recorded_at" := clock_timestamp();
  PERFORM "foundry_lock_rights_policy_version"(NEW."policy_version");
  SELECT p."effective_at" INTO policy_effective_at
  FROM "foundry_rights_policy_versions" p
  WHERE p."policy_version" = NEW."policy_version"
    AND p."policy_definition_sha256" = NEW."policy_definition_sha256"
    AND p."generation" = NEW."policy_generation";
  IF NOT FOUND OR NEW."revoked_at" < policy_effective_at THEN
    RAISE EXCEPTION 'rights-policy revocation predates or misses its exact definition' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_execution_projection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  confirmation_ok boolean;
  rights_ok boolean;
  compute_ok boolean;
  adapter_artifact_ok boolean;
  provider_deployment_ok boolean;
  bound_worker_profile_count bigint;
  stale_worker_profile_count bigint;
  expected_worker_profile_sha256s jsonb;
  job_compute_approval_id varchar(120);
  job_envelope_id varchar(120);
  job_provider_plan_json jsonb;
  job_provider_plan_planned_at timestamptz;
  job_envelope_created_at timestamptz;
  policy_dispatch_window_ttl_seconds integer;
  policy_confirmation_ttl_seconds integer;
  policy_compute_approval_ttl_seconds integer;
  policy_cost_observation_maximum_age_seconds integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'admitted_awaiting_executor'
       OR NEW."last_attempt_ordinal" <> 0
       OR NEW."fencing_token" <> 0
       OR NEW."total_cost_micro_usd" <> 0
       OR NEW."cancel_requested"
       OR NEW."revision" <> 0
       OR NEW."admitted_at" < statement_timestamp() - interval '5 seconds'
       OR NEW."admitted_at" > clock_timestamp() + interval '1 second'
       OR NEW."updated_at" <> NEW."admitted_at" THEN
      RAISE EXCEPTION 'execution admission must remain inert at revision zero' USING ERRCODE = '23514';
    END IF;

    PERFORM "foundry_lock_rights_policy_version"(NEW."rights_policy_version");
    PERFORM "foundry_lock_execution_control_scopes"(
      NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
      NEW."project_id", NEW."id", NULL
    );

    SELECT j."compute_approval_id", j."envelope_id", j."provider_plan_json",
           j."provider_plan_planned_at", j."envelope_created_at",
           p."dispatch_window_ttl_seconds", p."execution_confirmation_ttl_seconds",
           p."compute_approval_ttl_seconds", p."cost_observation_maximum_age_seconds"
    INTO job_compute_approval_id, job_envelope_id, job_provider_plan_json,
         job_provider_plan_planned_at, job_envelope_created_at,
         policy_dispatch_window_ttl_seconds, policy_confirmation_ttl_seconds,
         policy_compute_approval_ttl_seconds, policy_cost_observation_maximum_age_seconds
    FROM "foundry_jobs" j
    JOIN "foundry_execution_policies" p
      ON p."execution_policy_sha256" = j."execution_policy_sha256"
    WHERE j."job_id" = NEW."job_id"
      AND j."project_id" = NEW."project_id"
      AND j."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND j."job_spec_sha256" = NEW."job_spec_sha256"
      AND j."registered_at" <= NEW."admitted_at"
    FOR UPDATE OF j;
    IF NOT FOUND OR job_compute_approval_id IS DISTINCT FROM NEW."compute_approval_id" THEN
      RAISE EXCEPTION 'execution compute approval does not match its immutable envelope' USING ERRCODE = '23514';
    END IF;
    IF NEW."dispatch_deadline" > job_envelope_created_at
         + make_interval(secs => policy_dispatch_window_ttl_seconds) THEN
      RAISE EXCEPTION 'execution dispatch window exceeds its immutable policy' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW."execution_subject_json") IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'execution subject JSON must have the exact closed V0 shape'
        USING ERRCODE = '23514';
    END IF;
    IF "foundry_jsonb_object_key_count"(NEW."execution_subject_json") <> 28
       OR NOT (NEW."execution_subject_json" ?& ARRAY[
         'schemaVersion', 'subjectId', 'projectId', 'jobSpecSha256',
         'executionEnvelopeSha256', 'ingestManifestSha256',
         'intakeAdmissionResultSha256', 'intakeStagingIndexSha256',
         'providerPlanSha256', 'executionPolicySha256',
         'executionConfirmationSha256', 'rightsApprovalSha256',
         'rightsPolicyEvidenceSha256', 'rightsPolicyDefinitionSha256',
         'computeApprovalSha256', 'providerKind', 'providerAdapterId',
         'providerAdapterVersion', 'providerAdapterArtifactSha256',
         'providerDeploymentSha256', 'workerProfileSha256s',
         'pricingSnapshotSha256', 'pricingSnapshotExpiresAt', 'createdAt',
         'dispatchDeadline', 'maximumAttempts', 'budgetPolicy',
         'checkpointContract'
       ]) THEN
      RAISE EXCEPTION 'execution subject JSON must have the exact closed V0 shape'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM unnest(ARRAY[
        'schemaVersion', 'subjectId', 'projectId', 'jobSpecSha256',
        'executionEnvelopeSha256', 'ingestManifestSha256',
        'intakeAdmissionResultSha256', 'intakeStagingIndexSha256',
        'providerPlanSha256', 'executionPolicySha256',
        'executionConfirmationSha256', 'rightsApprovalSha256',
        'rightsPolicyEvidenceSha256', 'rightsPolicyDefinitionSha256',
        'providerKind', 'providerAdapterId', 'providerAdapterVersion',
        'providerAdapterArtifactSha256', 'providerDeploymentSha256',
        'pricingSnapshotSha256', 'pricingSnapshotExpiresAt', 'createdAt',
        'dispatchDeadline'
      ]) subject_string_key
      WHERE jsonb_typeof(NEW."execution_subject_json"->subject_string_key)
        IS DISTINCT FROM 'string'
    ) OR (
      NEW."compute_approval_sha256" IS NULL
      AND jsonb_typeof(NEW."execution_subject_json"->'computeApprovalSha256')
        IS DISTINCT FROM 'null'
    ) OR (
      NEW."compute_approval_sha256" IS NOT NULL
      AND jsonb_typeof(NEW."execution_subject_json"->'computeApprovalSha256')
        IS DISTINCT FROM 'string'
    ) THEN
      RAISE EXCEPTION 'execution subject scalar leaves must preserve their exact JSON types'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW."execution_subject_json"->'maximumAttempts')
         IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'execution subject maximumAttempts must be an exact numeric literal'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."execution_subject_json"->>'schemaVersion'
         IS DISTINCT FROM 'omnitwin.foundry.execution-subject.v0'
       OR jsonb_typeof(NEW."execution_subject_json"->'subjectId')
            IS DISTINCT FROM 'string'
       OR NEW."execution_subject_json"->>'subjectId' IS DISTINCT FROM job_envelope_id
       OR NEW."execution_subject_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
       OR NEW."execution_subject_json"->>'jobSpecSha256' IS DISTINCT FROM NEW."job_spec_sha256"
       OR NEW."execution_subject_json"->>'executionEnvelopeSha256'
            IS DISTINCT FROM NEW."execution_envelope_sha256"
       OR NEW."execution_subject_json"->>'ingestManifestSha256'
            IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
       OR NEW."execution_subject_json"->>'intakeAdmissionResultSha256'
            IS DISTINCT FROM NEW."intake_admission_result_sha256"
       OR NEW."execution_subject_json"->>'intakeStagingIndexSha256'
            IS DISTINCT FROM NEW."intake_staging_index_sha256"
       OR NEW."execution_subject_json"->>'providerPlanSha256'
            IS DISTINCT FROM NEW."provider_plan_sha256"
       OR NEW."execution_subject_json"->>'executionPolicySha256'
            IS DISTINCT FROM NEW."execution_policy_sha256"
       OR NEW."execution_subject_json"->>'executionConfirmationSha256'
            IS DISTINCT FROM NEW."confirmation_sha256"
       OR NEW."execution_subject_json"->>'rightsApprovalSha256'
            IS DISTINCT FROM NEW."rights_approval_sha256"
       OR NEW."execution_subject_json"->>'rightsPolicyEvidenceSha256'
            IS DISTINCT FROM NEW."rights_policy_evidence_sha256"
       OR NEW."execution_subject_json"->>'rightsPolicyDefinitionSha256'
            IS DISTINCT FROM NEW."rights_policy_definition_sha256"
       OR NEW."execution_subject_json"->>'computeApprovalSha256'
            IS DISTINCT FROM NEW."compute_approval_sha256"
       OR NEW."execution_subject_json"->>'providerKind' IS DISTINCT FROM NEW."provider_kind"
       OR NEW."execution_subject_json"->>'providerAdapterId'
            IS DISTINCT FROM NEW."provider_adapter_id"
       OR NEW."execution_subject_json"->>'providerAdapterVersion'
            IS DISTINCT FROM NEW."provider_adapter_version"
       OR NEW."execution_subject_json"->>'providerAdapterArtifactSha256'
            IS DISTINCT FROM NEW."provider_adapter_artifact_sha256"
       OR NEW."execution_subject_json"->>'providerDeploymentSha256'
            IS DISTINCT FROM NEW."provider_deployment_sha256"
       OR NEW."execution_subject_json"->>'pricingSnapshotSha256'
            IS DISTINCT FROM NEW."pricing_snapshot_sha256"
       OR jsonb_typeof(NEW."execution_subject_json"->'pricingSnapshotExpiresAt')
            IS DISTINCT FROM 'string'
       OR NEW."execution_subject_json"->>'pricingSnapshotExpiresAt' IS DISTINCT FROM
            to_char(NEW."pricing_snapshot_expires_at" AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR jsonb_typeof(NEW."execution_subject_json"->'createdAt')
            IS DISTINCT FROM 'string'
       OR NEW."execution_subject_json"->>'createdAt' IS DISTINCT FROM
            to_char(job_envelope_created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       OR jsonb_typeof(NEW."execution_subject_json"->'dispatchDeadline')
            IS DISTINCT FROM 'string'
       OR NEW."execution_subject_json"->>'dispatchDeadline' IS DISTINCT FROM
            to_char(NEW."dispatch_deadline" AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        OR (NEW."execution_subject_json"->'maximumAttempts' #>> '{}')::numeric <> 1
        OR jsonb_typeof(NEW."execution_subject_json"->'checkpointContract') <> 'null'
        OR jsonb_typeof(NEW."execution_subject_json"->'budgetPolicy')
             IS DISTINCT FROM 'object'
        OR "foundry_jsonb_object_key_count"(
             NEW."execution_subject_json"->'budgetPolicy'
           ) <> 6
        OR NOT (NEW."execution_subject_json"->'budgetPolicy' ?& ARRAY[
             'currency', 'costWarningMicroUsd', 'costHardStopMicroUsd',
             'terminationReserveMicroUsd', 'absoluteCostCapMicroUsd',
             'costObservationMaximumAgeSeconds'
           ])
        OR jsonb_typeof(NEW."execution_subject_json"->'budgetPolicy'->'currency')
             IS DISTINCT FROM 'string'
        OR jsonb_typeof(
             NEW."execution_subject_json"->'budgetPolicy'->'costWarningMicroUsd'
           ) IS DISTINCT FROM 'string'
        OR jsonb_typeof(
             NEW."execution_subject_json"->'budgetPolicy'->'costHardStopMicroUsd'
           ) IS DISTINCT FROM 'string'
        OR jsonb_typeof(
             NEW."execution_subject_json"->'budgetPolicy'->'terminationReserveMicroUsd'
           ) IS DISTINCT FROM 'string'
        OR jsonb_typeof(
             NEW."execution_subject_json"->'budgetPolicy'->'absoluteCostCapMicroUsd'
           ) IS DISTINCT FROM 'string'
        OR NEW."execution_subject_json"->'budgetPolicy'->>'currency' IS DISTINCT FROM 'USD'
       OR NEW."execution_subject_json"->'budgetPolicy'->>'costWarningMicroUsd'
            IS DISTINCT FROM NEW."cost_warning_micro_usd"::text
       OR NEW."execution_subject_json"->'budgetPolicy'->>'costHardStopMicroUsd'
            IS DISTINCT FROM NEW."cost_hard_stop_micro_usd"::text
       OR NEW."execution_subject_json"->'budgetPolicy'->>'terminationReserveMicroUsd'
            IS DISTINCT FROM NEW."termination_reserve_micro_usd"::text
       OR NEW."execution_subject_json"->'budgetPolicy'->>'absoluteCostCapMicroUsd'
            IS DISTINCT FROM NEW."absolute_cost_cap_micro_usd"::text
        OR jsonb_typeof(
             NEW."execution_subject_json"->'budgetPolicy'->'costObservationMaximumAgeSeconds'
           ) IS DISTINCT FROM 'number'
        OR (
             NEW."execution_subject_json"->'budgetPolicy'->'costObservationMaximumAgeSeconds'
             #>> '{}'
           )::numeric IS DISTINCT FROM policy_cost_observation_maximum_age_seconds::numeric THEN
      RAISE EXCEPTION 'execution subject JSON does not exactly bind the immutable admission evidence'
        USING ERRCODE = '23514';
    END IF;

    SELECT true INTO confirmation_ok
    FROM "foundry_execution_confirmations" c
    WHERE c."confirmation_id" = NEW."confirmation_id"
      AND c."job_id" = NEW."job_id"
      AND c."project_id" = NEW."project_id"
      AND c."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND c."job_spec_sha256" = NEW."job_spec_sha256"
      AND c."confirmation_sha256" = NEW."confirmation_sha256"
      AND c."confirmed_at" >= job_envelope_created_at
      AND c."confirmed_at" <= NEW."admitted_at"
      AND c."registered_at" <= NEW."admitted_at"
      AND c."expires_at" > NEW."admitted_at"
      AND c."expires_at" <= NEW."dispatch_deadline"
      AND c."expires_at" <= c."confirmed_at" + make_interval(secs => policy_confirmation_ttl_seconds);
    IF confirmation_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'execution confirmation is absent, stale, or not yet valid' USING ERRCODE = '23514';
    END IF;

    SELECT true INTO rights_ok
    FROM "foundry_rights_approvals" r
    WHERE r."id" = NEW."rights_approval_id"
      AND r."job_id" = NEW."job_id"
      AND r."project_id" = NEW."project_id"
      AND r."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND r."job_spec_sha256" = NEW."job_spec_sha256"
      AND r."reviewed_ingest_manifest_sha256" = NEW."reviewed_ingest_manifest_sha256"
      AND r."execution_policy_sha256" = NEW."execution_policy_sha256"
      AND r."policy_version" = NEW."rights_policy_version"
      AND r."policy_definition_sha256" = NEW."rights_policy_definition_sha256"
      AND r."policy_evidence_sha256" = NEW."rights_policy_evidence_sha256"
      AND r."policy_generation" = NEW."rights_policy_generation"
      AND r."policy_maximum_approval_ttl_seconds" = NEW."rights_policy_maximum_approval_ttl_seconds"
      AND r."rights_approval_sha256" = NEW."rights_approval_sha256"
      AND r."decision" = 'allowed'
      AND r."decided_at" <= NEW."admitted_at"
      AND r."registered_at" <= NEW."admitted_at"
      AND r."expires_at" > NEW."admitted_at"
      AND "foundry_rights_policy_is_active"(
        r."policy_version", r."policy_definition_sha256", r."policy_generation", NEW."admitted_at"
      );
    IF rights_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'rights approval is absent, stale, or not yet valid' USING ERRCODE = '23514';
    END IF;

    IF NEW."provider_kind" NOT IN ('local_cpu', 'local_cuda') THEN
      SELECT true INTO compute_ok
      FROM "foundry_compute_approvals" a
      WHERE a."approval_id" = NEW."compute_approval_id"
        AND a."job_id" = NEW."job_id"
        AND a."project_id" = NEW."project_id"
        AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
        AND a."job_spec_sha256" = NEW."job_spec_sha256"
        AND a."provider_kind" = NEW."provider_kind"
        AND a."provider_adapter_id" = NEW."provider_adapter_id"
        AND a."provider_adapter_version" = NEW."provider_adapter_version"
        AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
        AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
        AND a."maximum_cost_micro_usd" = NEW."compute_approval_maximum_cost_micro_usd"
        AND a."compute_approval_sha256" = NEW."compute_approval_sha256"
        AND a."maximum_cost_micro_usd" >= NEW."absolute_cost_cap_micro_usd"
        AND a."maximum_cost_micro_usd" <= NEW."budget_cap_micro_usd"
        AND a."approved_at" >= job_envelope_created_at
        AND a."approved_at" <= NEW."admitted_at"
        AND a."registered_at" <= NEW."admitted_at"
        AND a."expires_at" > NEW."admitted_at"
        AND a."expires_at" <= NEW."dispatch_deadline"
        AND a."expires_at" <= a."approved_at" + make_interval(secs => policy_compute_approval_ttl_seconds);
      IF compute_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'compute approval is absent, stale, or not yet valid' USING ERRCODE = '23514';
      END IF;
    END IF;

    SELECT true INTO adapter_artifact_ok
    FROM "foundry_provider_adapter_artifacts" aa
    WHERE aa."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND aa."provider_kind" = NEW."provider_kind"
      AND aa."provider_adapter_id" = NEW."provider_adapter_id"
      AND aa."provider_adapter_version" = NEW."provider_adapter_version"
      AND aa."reviewed_at" <= job_provider_plan_planned_at
      AND aa."registered_at" <= NEW."admitted_at"
      AND aa."expires_at" >= NEW."dispatch_deadline";
    IF adapter_artifact_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'provider adapter artifact is absent, stale, or not yet valid' USING ERRCODE = '23514';
    END IF;

    SELECT true INTO provider_deployment_ok
    FROM "foundry_provider_deployments" d
    WHERE d."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND d."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND d."provider_kind" = NEW."provider_kind"
      AND d."provider_adapter_id" = NEW."provider_adapter_id"
      AND d."provider_adapter_version" = NEW."provider_adapter_version"
      AND d."observed_at" <= job_provider_plan_planned_at
      AND d."registered_at" <= NEW."admitted_at"
      AND d."expires_at" >= NEW."dispatch_deadline";
    IF provider_deployment_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'provider deployment is absent, stale, or not yet valid' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      WITH expected_stage AS (
        SELECT
          stage.value->>'stageId' AS stage_id,
          stage.value->>'workerProfileSha256' AS worker_profile_sha256
        FROM jsonb_array_elements(job_provider_plan_json->'stages') stage(value)
      ), bound_stage AS (
        SELECT jwp."stage_id", jwp."worker_profile_sha256"
        FROM "foundry_job_worker_profiles" jwp
        WHERE jwp."job_id" = NEW."job_id"
          AND jwp."project_id" = NEW."project_id"
          AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
          AND jwp."provider_plan_sha256" = NEW."provider_plan_sha256"
          AND jwp."trusted_worker_profile_set_sha256" =
                NEW."trusted_worker_profile_set_sha256"
      )
      SELECT 1
      FROM expected_stage expected
      FULL JOIN bound_stage bound ON bound.stage_id = expected.stage_id
      WHERE expected.stage_id IS NULL
         OR bound.stage_id IS NULL
         OR bound.worker_profile_sha256 IS DISTINCT FROM
              expected.worker_profile_sha256
    ) THEN
      RAISE EXCEPTION 'trusted worker-profile links must exactly cover every provider-plan stage'
        USING ERRCODE = '23514';
    END IF;

    SELECT count(DISTINCT jwp."worker_profile_sha256"), count(*) FILTER (
      WHERE wp."reviewed_at" > job_provider_plan_planned_at
         OR wp."registered_at" > NEW."admitted_at"
         OR wp."expires_at" < NEW."dispatch_deadline"
         OR jwp."registered_at" > NEW."admitted_at"
         OR (NEW."provider_kind" IN ('local_cpu', 'local_cuda') AND NOT wp."local_execution_allowed")
    )
    INTO bound_worker_profile_count, stale_worker_profile_count
    FROM "foundry_job_worker_profiles" jwp
    JOIN "foundry_trusted_worker_profiles" wp
      ON wp."worker_profile_sha256" = jwp."worker_profile_sha256"
     AND wp."operation_class" = jwp."operation_class"
    WHERE jwp."job_id" = NEW."job_id"
      AND jwp."project_id" = NEW."project_id"
      AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND jwp."provider_plan_sha256" = NEW."provider_plan_sha256"
      AND jwp."trusted_worker_profile_set_sha256" = NEW."trusted_worker_profile_set_sha256";
    IF bound_worker_profile_count <> NEW."trusted_worker_profile_count"
       OR stale_worker_profile_count <> 0 THEN
      RAISE EXCEPTION 'trusted worker-profile set is incomplete, stale, or not yet valid' USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_agg(
      to_jsonb(worker_profile.worker_profile_sha256)
      ORDER BY worker_profile.worker_profile_sha256 COLLATE "C"
    ) INTO expected_worker_profile_sha256s
    FROM (
      SELECT DISTINCT jwp."worker_profile_sha256"
      FROM "foundry_job_worker_profiles" jwp
      WHERE jwp."job_id" = NEW."job_id"
        AND jwp."project_id" = NEW."project_id"
        AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
        AND jwp."provider_plan_sha256" = NEW."provider_plan_sha256"
        AND jwp."trusted_worker_profile_set_sha256" =
              NEW."trusted_worker_profile_set_sha256"
    ) worker_profile;
    IF NEW."execution_subject_json"->'workerProfileSha256s'
         IS DISTINCT FROM expected_worker_profile_sha256s THEN
      RAISE EXCEPTION 'execution subject worker-profile digest set is not exact, sorted, and complete'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."execution_subject_sha256" IS DISTINCT FROM
         "foundry_nul_domain_jsonb_sha256"(
           'OMNITWIN_FOUNDRY_EXECUTION_SUBJECT_V0',
           NEW."execution_subject_json"
         ) THEN
      RAISE EXCEPTION 'execution subject digest does not match its exact canonical JSON'
        USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM "foundry_kill_switches" k
      WHERE k."state" = 'active' AND (
        k."scope" = 'global'
        OR (k."scope" = 'provider' AND k."provider_kind" = NEW."provider_kind"
          AND k."provider_adapter_id" = NEW."provider_adapter_id"
          AND k."provider_adapter_version" = NEW."provider_adapter_version")
        OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
      )
    ) THEN
      RAISE EXCEPTION 'execution admission is blocked by an active kill switch' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'execution projection updates require a controlled causal trigger'
      USING ERRCODE = '55000';
  END IF;

  IF ROW(
    NEW."job_id", NEW."project_id", NEW."execution_envelope_sha256",
    NEW."execution_subject_sha256", NEW."execution_subject_json", NEW."job_spec_sha256",
    NEW."provider_plan_sha256", NEW."reviewed_ingest_manifest_sha256",
    NEW."intake_admission_result_sha256", NEW."intake_staging_index_sha256", NEW."execution_policy_sha256",
    NEW."pricing_snapshot_sha256", NEW."provider_kind", NEW."provider_adapter_id",
    NEW."provider_adapter_version", NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."trusted_worker_profile_set_sha256", NEW."trusted_worker_profile_count",
    NEW."pricing_currency", NEW."pricing_snapshot_expires_at",
    NEW."budget_cap_micro_usd", NEW."cost_warning_micro_usd", NEW."cost_hard_stop_micro_usd",
    NEW."termination_reserve_micro_usd", NEW."absolute_cost_cap_micro_usd",
    NEW."max_wall_clock_seconds", NEW."orchestration_overhead_seconds",
    NEW."cancel_grace_seconds", NEW."termination_grace_seconds",
    NEW."worker_self_deadline_seconds", NEW."termination_confirmation_timeout_seconds",
    NEW."provider_maximum_execution_ttl_seconds", NEW."dispatch_deadline", NEW."rights_approval_id",
    NEW."rights_approval_sha256",
    NEW."rights_policy_version", NEW."rights_policy_definition_sha256",
    NEW."rights_policy_evidence_sha256",
    NEW."rights_policy_generation", NEW."rights_policy_maximum_approval_ttl_seconds",
    NEW."compute_approval_id", NEW."compute_approval_sha256", NEW."compute_approval_maximum_cost_micro_usd",
    NEW."confirmation_id", NEW."confirmation_sha256",
    NEW."admitted_by_user_id", NEW."idempotency_key", NEW."request_digest", NEW."admitted_at"
  ) IS DISTINCT FROM ROW(
    OLD."job_id", OLD."project_id", OLD."execution_envelope_sha256",
    OLD."execution_subject_sha256", OLD."execution_subject_json", OLD."job_spec_sha256",
    OLD."provider_plan_sha256", OLD."reviewed_ingest_manifest_sha256",
    OLD."intake_admission_result_sha256", OLD."intake_staging_index_sha256", OLD."execution_policy_sha256",
    OLD."pricing_snapshot_sha256", OLD."provider_kind", OLD."provider_adapter_id",
    OLD."provider_adapter_version", OLD."provider_adapter_artifact_sha256", OLD."provider_deployment_sha256",
    OLD."trusted_worker_profile_set_sha256", OLD."trusted_worker_profile_count",
    OLD."pricing_currency", OLD."pricing_snapshot_expires_at",
    OLD."budget_cap_micro_usd", OLD."cost_warning_micro_usd", OLD."cost_hard_stop_micro_usd",
    OLD."termination_reserve_micro_usd", OLD."absolute_cost_cap_micro_usd",
    OLD."max_wall_clock_seconds", OLD."orchestration_overhead_seconds",
    OLD."cancel_grace_seconds", OLD."termination_grace_seconds",
    OLD."worker_self_deadline_seconds", OLD."termination_confirmation_timeout_seconds",
    OLD."provider_maximum_execution_ttl_seconds", OLD."dispatch_deadline", OLD."rights_approval_id",
    OLD."rights_approval_sha256",
    OLD."rights_policy_version", OLD."rights_policy_definition_sha256",
    OLD."rights_policy_evidence_sha256",
    OLD."rights_policy_generation", OLD."rights_policy_maximum_approval_ttl_seconds",
    OLD."compute_approval_id", OLD."compute_approval_sha256", OLD."compute_approval_maximum_cost_micro_usd",
    OLD."confirmation_id", OLD."confirmation_sha256",
    OLD."admitted_by_user_id", OLD."idempotency_key", OLD."request_digest", OLD."admitted_at"
  ) THEN
    RAISE EXCEPTION 'execution identity and authority bindings are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'execution update requires the next revision and a later timestamp' USING ERRCODE = '40001';
  END IF;
  IF NEW."total_cost_micro_usd" < OLD."total_cost_micro_usd" THEN
    RAISE EXCEPTION 'execution cost cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF NEW."total_cost_micro_usd" <> OLD."total_cost_micro_usd" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'execution cost changes require an append-only cost observation' USING ERRCODE = '23514';
  END IF;
  IF NEW."last_attempt_ordinal" <> OLD."last_attempt_ordinal"
     OR NEW."fencing_token" <> OLD."fencing_token" THEN
    IF pg_trigger_depth() < 2
       OR NEW."last_attempt_ordinal" <> OLD."last_attempt_ordinal" + 1
       OR NEW."fencing_token" <> OLD."fencing_token" + 1
       OR NEW."state" <> 'authorized' THEN
      RAISE EXCEPTION 'attempt ordinal and fence advance only through attempt insertion' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD."cancel_requested" AND NOT NEW."cancel_requested" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'cancel request can reset only when a fenced retry is created' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (
    (OLD."state" = 'admitted_awaiting_executor' AND NEW."state" IN ('authorized', 'terminal_cancelled', 'terminal_killed'))
    OR (OLD."state" = 'authorized' AND NEW."state" IN ('submit_pending', 'stop_pending', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded'))
    OR (OLD."state" = 'submit_pending' AND NEW."state" IN ('provider_unknown', 'queued', 'running', 'stop_pending', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded'))
    OR (OLD."state" = 'provider_unknown' AND NEW."state" IN ('queued', 'running', 'validating', 'stop_pending', 'terminating', 'termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'queued' AND NEW."state" IN ('running', 'checkpointing', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'running' AND NEW."state" IN ('checkpointing', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'checkpointing' AND NEW."state" IN ('running', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'stop_pending' AND NEW."state" IN ('terminating', 'termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'terminating' AND NEW."state" IN ('termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'termination_unconfirmed' AND NEW."state" IN ('terminating', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'validating' AND NEW."state" IN ('terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_validation_failed', 'terminal_provider_lost'))
  ) THEN
    RAISE EXCEPTION 'illegal execution state transition: % -> %', OLD."state", NEW."state" USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_job_pricing_snapshot_age"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  maximum_pricing_age_seconds integer;
  dispatch_window_ttl_seconds integer;
  bound_execution_policy_json jsonb;
  deployment_observed_at timestamptz;
  deployment_expires_at timestamptz;
  job_created_at timestamptz;
  estimated_cost_usd numeric;
  budget_cap_usd numeric;
  job_stage_ids jsonb;
  plan_stage_ids jsonb;
  runtime_graph jsonb;
  critical_path_seconds numeric;
BEGIN
  NEW."registered_at" := clock_timestamp();
  SELECT policy."pricing_snapshot_maximum_age_seconds",
         policy."dispatch_window_ttl_seconds", policy."policy_json"
  INTO maximum_pricing_age_seconds, dispatch_window_ttl_seconds,
       bound_execution_policy_json
  FROM "foundry_execution_policies" policy
  WHERE policy."execution_policy_sha256" = NEW."execution_policy_sha256";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job execution policy is absent' USING ERRCODE = '23503';
  END IF;
  SELECT deployment."observed_at", deployment."expires_at"
  INTO deployment_observed_at, deployment_expires_at
  FROM "foundry_provider_deployments" deployment
  WHERE deployment."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND deployment."provider_kind" = NEW."provider_kind"
    AND deployment."provider_adapter_id" = NEW."provider_adapter_id"
    AND deployment."provider_adapter_version" = NEW."provider_adapter_version"
    AND deployment."provider_adapter_artifact_sha256" =
          NEW."provider_adapter_artifact_sha256";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job provider deployment is absent' USING ERRCODE = '23503';
  END IF;

  IF jsonb_typeof(NEW."job_spec_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'job specification must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."job_spec_json") <> 16
     OR NOT (NEW."job_spec_json" ?& ARRAY[
       'schemaVersion', 'id', 'projectId', 'ingestManifestSha256',
       'executionIntent', 'providerKind', 'providerAdapterId', 'stages',
       'objectStorageProfile', 'sourceMountMode', 'outputPrefix',
       'estimatedCostUsd', 'budgetCapUsd', 'killSwitchEnabled',
       'computeApprovalId', 'createdAt'
     ])
     OR jsonb_typeof(NEW."job_spec_json"->'schemaVersion') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'id') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'projectId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'ingestManifestSha256')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'executionIntent') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'providerKind') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'providerAdapterId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'stages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."job_spec_json"->'objectStorageProfile')
          NOT IN ('null', 'string')
     OR jsonb_typeof(NEW."job_spec_json"->'sourceMountMode') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'outputPrefix') IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."job_spec_json"->'estimatedCostUsd') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."job_spec_json"->'budgetCapUsd') IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."job_spec_json"->'killSwitchEnabled') IS DISTINCT FROM 'boolean'
     OR jsonb_typeof(NEW."job_spec_json"->'computeApprovalId') NOT IN ('null', 'string')
     OR jsonb_typeof(NEW."job_spec_json"->'createdAt') IS DISTINCT FROM 'string'
     OR "foundry_is_job_stage_array"(NEW."job_spec_json"->'stages') IS NOT TRUE THEN
    RAISE EXCEPTION 'job specification must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."job_spec_json"->>'createdAt'
       !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
     OR left(NEW."job_spec_json"->>'createdAt', 4) = '0000' THEN
    RAISE EXCEPTION 'job createdAt must be a canonical UTC millisecond instant'
      USING ERRCODE = '23514';
  END IF;
  BEGIN
    job_created_at := (NEW."job_spec_json"->>'createdAt')::timestamptz;
  EXCEPTION
    WHEN SQLSTATE '22007' OR SQLSTATE '22008' THEN
      RAISE EXCEPTION 'job createdAt must be a real UTC millisecond instant'
        USING ERRCODE = '23514';
  END;
  IF NEW."job_spec_json"->>'createdAt' IS DISTINCT FROM to_char(
       job_created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     ) THEN
    RAISE EXCEPTION 'job createdAt must round-trip as a canonical UTC instant'
      USING ERRCODE = '23514';
  END IF;

  estimated_cost_usd := (NEW."job_spec_json"->'estimatedCostUsd' #>> '{}')::numeric;
  budget_cap_usd := (NEW."job_spec_json"->'budgetCapUsd' #>> '{}')::numeric;
  IF estimated_cost_usd < 0
     OR budget_cap_usd < 0
     OR estimated_cost_usd > budget_cap_usd
     OR estimated_cost_usd > 9007199254.740991::numeric
     OR budget_cap_usd > 9007199254.740991::numeric THEN
    RAISE EXCEPTION 'job USD amounts must remain within safe micro-USD bounds'
      USING ERRCODE = '23514';
  END IF;
  IF estimated_cost_usd * 1000000 <> trunc(estimated_cost_usd * 1000000)
     OR budget_cap_usd * 1000000 <> trunc(budget_cap_usd * 1000000)
     OR estimated_cost_usd * 1000000 > 9007199254740991::numeric
     OR budget_cap_usd * 1000000 > 9007199254740991::numeric
     OR estimated_cost_usd * 1000000 <> NEW."estimated_cost_micro_usd"::numeric
     OR budget_cap_usd * 1000000 <> NEW."budget_cap_micro_usd"::numeric THEN
    RAISE EXCEPTION 'job USD amounts must exactly bind safe integer micro-USD columns'
      USING ERRCODE = '23514';
  END IF;
  IF estimated_cost_usd::double precision * 1000000::double precision <>
          trunc(estimated_cost_usd::double precision * 1000000::double precision)
     OR budget_cap_usd::double precision * 1000000::double precision <>
          trunc(budget_cap_usd::double precision * 1000000::double precision)
     OR estimated_cost_usd::double precision * 1000000::double precision <>
          NEW."estimated_cost_micro_usd"::double precision
     OR budget_cap_usd::double precision * 1000000::double precision <>
          NEW."budget_cap_micro_usd"::double precision THEN
    RAISE EXCEPTION 'job USD amounts must exactly bind safe integer micro-USD columns'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."job_spec_json"->>'schemaVersion'
       IS DISTINCT FROM 'omnitwin.foundry.job-spec.v0'
     OR NEW."job_spec_json"->>'id' IS DISTINCT FROM NEW."job_id"
     OR NEW."job_spec_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
     OR NEW."job_spec_json"->>'ingestManifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."job_spec_json"->>'executionIntent' IS DISTINCT FROM NEW."execution_intent"
     OR NEW."job_spec_json"->>'providerKind' IS DISTINCT FROM NEW."provider_kind"
     OR NEW."job_spec_json"->>'providerAdapterId' IS DISTINCT FROM NEW."provider_adapter_id"
     OR NEW."job_spec_json"->>'sourceMountMode' IS DISTINCT FROM 'read_only'
     OR "foundry_is_safe_relative_path"(NEW."job_spec_json"->>'outputPrefix') IS NOT TRUE
     OR (
       NEW."job_spec_json"->'objectStorageProfile' <> 'null'::jsonb
       AND NEW."job_spec_json"->>'objectStorageProfile'
             !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     )
     OR NEW."job_spec_json"->'killSwitchEnabled' IS DISTINCT FROM 'true'::jsonb
     OR NEW."job_spec_json"->>'computeApprovalId'
       IS DISTINCT FROM NEW."compute_approval_id"
     OR NEW."job_spec_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.job-spec.v0', NEW."job_spec_json"
     ) THEN
    RAISE EXCEPTION 'job specification JSON and digest must bind the exact job row'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."provider_kind" IN ('local_cpu', 'local_cuda') AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value)
    WHERE stage.value->'rightsPurposes' @> ' ["model_training"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'local execution cannot authorize model-training stages'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_is_execution_ingest_manifest"(
       NEW."reviewed_ingest_manifest_json"
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'reviewed ingest manifest must satisfy the closed execution schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."reviewed_ingest_manifest_json"->>'projectId'
       IS DISTINCT FROM NEW."project_id"
     OR NEW."reviewed_ingest_manifest_sha256" IS DISTINCT FROM
       "foundry_ecmascript_domain_jsonb_sha256"(
         'omnitwin.foundry.ingest-manifest.v0',
         NEW."reviewed_ingest_manifest_json"
       ) THEN
    RAISE EXCEPTION 'reviewed ingest manifest JSON and digest must bind the exact project'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH referenced_input AS (
      SELECT stage.value AS stage_value, input_asset_id.value AS asset_id
      FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(
        stage.value->'inputAssetIds'
      ) input_asset_id(value)
    ), declared_asset AS (
      SELECT asset.value AS asset_value, asset.value->>'id' AS asset_id
      FROM jsonb_array_elements(
        NEW."reviewed_ingest_manifest_json"->'assets'
      ) asset(value)
    )
    SELECT 1
    FROM referenced_input input
    LEFT JOIN declared_asset asset ON asset.asset_id = input.asset_id
    WHERE asset.asset_value IS NULL
       OR asset.asset_value->>'accessState' = 'blocked_legal'
       OR asset.asset_value->'rights'->>'basis' = 'unknown'
       OR asset.asset_value->'rights'->'termsReviewedAt' = 'null'::jsonb
       OR asset.asset_value->'rights'->'termsReference' = 'null'::jsonb
       OR asset.asset_value->'rights'->>'commercialUse' <> 'allowed'
       OR (
         input.stage_value->'rightsPurposes' @> '["model_training"]'::jsonb
         AND asset.asset_value->'rights'->>'modelTrainingUse' <> 'allowed'
       )
       OR (
         (
           input.stage_value->'rightsPurposes' @> '["redistribution"]'::jsonb
           OR input.stage_value->'rightsPurposes' @> '["public_release"]'::jsonb
         )
         AND asset.asset_value->'rights'->>'redistribution' <> 'allowed'
       )
  ) THEN
    RAISE EXCEPTION 'job stage inputs fail the reviewed manifest rights gate'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_is_intake_admission_result"(
       NEW."intake_admission_result_json"
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'intake admission result must satisfy its closed self-bound schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."intake_admission_result_json"->>'resultSha256'
       IS DISTINCT FROM NEW."intake_admission_result_sha256"
     OR NEW."intake_admission_result_json"->>'manifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."intake_admission_result_json"->'manifest'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_json" THEN
    RAISE EXCEPTION 'intake admission result must bind the exact reviewed manifest and row digest'
      USING ERRCODE = '23514';
  END IF;

  IF "foundry_is_intake_staging_index"(
       NEW."intake_staging_index_json"
     ) IS NOT TRUE THEN
    RAISE EXCEPTION 'intake staging index must satisfy its closed self-bound schema'
      USING ERRCODE = '23514';
  END IF;
  IF ('sha256:' || (NEW."intake_staging_index_json"->>'stagingSha256'))
       IS DISTINCT FROM NEW."intake_staging_index_sha256"
     OR NEW."intake_staging_index_json"->>'manifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."intake_staging_index_json"->>'resultSha256'
       IS DISTINCT FROM NEW."intake_admission_result_sha256"
     OR NEW."intake_staging_index_json"->>'receiptSha256'
       IS DISTINCT FROM NEW."intake_admission_result_json"->>'receiptSha256'
     OR NEW."intake_staging_index_json"->>'reviewSha256'
       IS DISTINCT FROM NEW."intake_admission_result_json"->>'reviewSha256'
     OR (NEW."intake_staging_index_json"->>'stagedAssetCount')::numeric
       IS DISTINCT FROM jsonb_array_length(
         NEW."reviewed_ingest_manifest_json"->'assets'
       )::numeric THEN
    RAISE EXCEPTION 'intake staging index must bind the exact result and manifest evidence'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    WITH manifest_path AS (
      SELECT
        'source/' || (asset.value->>'relativePath') AS path,
        (asset.value->'sizeBytes' #>> '{}')::numeric AS size_bytes,
        substr(asset.value->>'sha256', 8) AS sha256
      FROM jsonb_array_elements(
        NEW."reviewed_ingest_manifest_json"->'assets'
      ) asset(value)
    ), staged_path AS (
      SELECT
        file.value->>'path' AS path,
        (file.value->'sizeBytes' #>> '{}')::numeric AS size_bytes,
        file.value->>'sha256' AS sha256
      FROM jsonb_array_elements(
        NEW."intake_staging_index_json"->'files'
      ) file(value)
      WHERE file.value->>'role' = 'staged_source'
    )
    SELECT 1
    FROM manifest_path manifest
    FULL JOIN staged_path staged ON staged.path = manifest.path
    WHERE manifest.path IS NULL OR staged.path IS NULL
       OR staged.size_bytes IS DISTINCT FROM manifest.size_bytes
       OR staged.sha256 IS DISTINCT FROM manifest.sha256
  ) THEN
    RAISE EXCEPTION 'staged source ledger must exactly bind reviewed manifest assets'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."provider_plan_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'provider plan must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."provider_plan_json") <> 22
     OR NOT (NEW."provider_plan_json" ?& ARRAY[
       'schemaVersion', 'executionIntent', 'authority', 'planId', 'jobId',
       'jobSpecSha256', 'reviewedIngestManifestSha256',
       'intakeAdmissionResultSha256', 'intakeStagingIndexSha256',
       'providerKind', 'providerAdapterId', 'providerAdapterVersion',
       'providerAdapterArtifactSha256', 'providerDeploymentSha256',
       'pricingCurrency', 'pricingBasis', 'pricingSnapshotSha256',
       'pricingSnapshotObservedAt', 'pricingSnapshotExpiresAt', 'plannedAt',
       'estimatedCostMicroUsd', 'stages'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('executionIntent'), ('authority'), ('planId'),
         ('jobId'), ('jobSpecSha256'), ('reviewedIngestManifestSha256'),
         ('intakeAdmissionResultSha256'), ('intakeStagingIndexSha256'),
         ('providerKind'), ('providerAdapterId'), ('providerAdapterVersion'),
         ('providerAdapterArtifactSha256'), ('providerDeploymentSha256'),
         ('pricingCurrency'), ('pricingBasis'), ('pricingSnapshotSha256'),
         ('pricingSnapshotObservedAt'), ('pricingSnapshotExpiresAt'),
         ('plannedAt'), ('estimatedCostMicroUsd')
       ) string_leaf(key)
       WHERE jsonb_typeof(NEW."provider_plan_json"->string_leaf.key)
               IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(NEW."provider_plan_json"->'stages') IS DISTINCT FROM 'array'
     OR "foundry_is_provider_plan_stage_array"(
          NEW."provider_plan_json"->'stages'
        ) IS NOT TRUE THEN
    RAISE EXCEPTION 'provider plan must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."provider_plan_json"->>'schemaVersion'
       IS DISTINCT FROM 'omnitwin.foundry.provider-plan-evidence.v0'
     OR NEW."provider_plan_json"->>'executionIntent' IS DISTINCT FROM 'execute'
     OR NEW."provider_plan_json"->>'authority' IS DISTINCT FROM 'none'
     OR NEW."provider_plan_json"->>'planId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
     OR NEW."provider_plan_json"->>'jobId' IS DISTINCT FROM NEW."job_id"
     OR NEW."provider_plan_json"->>'jobSpecSha256'
       IS DISTINCT FROM NEW."job_spec_sha256"
     OR NEW."provider_plan_json"->>'reviewedIngestManifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."provider_plan_json"->>'intakeAdmissionResultSha256'
       IS DISTINCT FROM NEW."intake_admission_result_sha256"
     OR NEW."provider_plan_json"->>'intakeStagingIndexSha256'
       IS DISTINCT FROM NEW."intake_staging_index_sha256"
     OR NEW."provider_plan_json"->>'providerKind' IS DISTINCT FROM NEW."provider_kind"
     OR NEW."provider_plan_json"->>'providerAdapterId'
       IS DISTINCT FROM NEW."provider_adapter_id"
     OR NEW."provider_plan_json"->>'providerAdapterVersion'
       IS DISTINCT FROM NEW."provider_adapter_version"
     OR NEW."provider_plan_json"->>'providerAdapterArtifactSha256'
       IS DISTINCT FROM NEW."provider_adapter_artifact_sha256"
     OR NEW."provider_plan_json"->>'providerDeploymentSha256'
       IS DISTINCT FROM NEW."provider_deployment_sha256"
     OR NEW."provider_plan_json"->>'pricingCurrency' IS DISTINCT FROM 'USD'
     OR NEW."provider_plan_json"->>'pricingBasis'
       NOT IN ('fixed_quote', 'metered_estimate')
     OR NEW."provider_plan_json"->>'pricingSnapshotSha256'
       IS DISTINCT FROM NEW."pricing_snapshot_sha256"
     OR NEW."provider_plan_json"->>'pricingSnapshotObservedAt' IS DISTINCT FROM to_char(
       NEW."pricing_snapshot_observed_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."provider_plan_json"->>'pricingSnapshotExpiresAt' IS DISTINCT FROM to_char(
       NEW."pricing_snapshot_expires_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."provider_plan_json"->>'plannedAt' IS DISTINCT FROM to_char(
       NEW."provider_plan_planned_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."provider_plan_json"->>'estimatedCostMicroUsd'
       IS DISTINCT FROM NEW."estimated_cost_micro_usd"::text
     OR NEW."provider_plan_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.provider-plan-evidence.v0', NEW."provider_plan_json"
     ) THEN
    RAISE EXCEPTION 'provider plan JSON and digest must bind the exact job row'
      USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(to_jsonb(stage.value->>'id') ORDER BY stage.value->>'id' COLLATE "C")
  INTO job_stage_ids
  FROM jsonb_array_elements(NEW."job_spec_json"->'stages') stage(value);
  SELECT jsonb_agg(
    to_jsonb(stage.value->>'stageId') ORDER BY stage.value->>'stageId' COLLATE "C"
  )
  INTO plan_stage_ids
  FROM jsonb_array_elements(NEW."provider_plan_json"->'stages') stage(value);
  IF job_stage_ids IS DISTINCT FROM plan_stage_ids
     OR (
       SELECT sum((stage.value->>'estimatedCostMicroUsd')::numeric)
       FROM jsonb_array_elements(NEW."provider_plan_json"->'stages') stage(value)
     ) IS DISTINCT FROM NEW."estimated_cost_micro_usd"::numeric
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(NEW."provider_plan_json"->'stages') stage(value)
       WHERE (stage.value->>'maximumRuntimeSeconds')::numeric
               > NEW."max_wall_clock_seconds"::numeric
     ) THEN
    RAISE EXCEPTION 'provider plan stages must exactly cover the job within cost and runtime bounds'
      USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_agg(
    jsonb_build_object(
      'stageId', job_stage.value->'id',
      'dependsOn', job_stage.value->'dependsOn',
      'maximumRuntimeSeconds', plan_stage.value->'maximumRuntimeSeconds'
    ) ORDER BY job_stage.value->>'id' COLLATE "C"
  )
  INTO runtime_graph
  FROM jsonb_array_elements(NEW."job_spec_json"->'stages') job_stage(value)
  JOIN LATERAL jsonb_array_elements(NEW."provider_plan_json"->'stages') plan_stage(value)
    ON plan_stage.value->>'stageId' = job_stage.value->>'id';
  critical_path_seconds := "foundry_stage_graph_critical_path_seconds"(runtime_graph);
  IF critical_path_seconds IS NULL
     OR critical_path_seconds + NEW."orchestration_overhead_seconds"::numeric
          > NEW."max_wall_clock_seconds"::numeric THEN
    RAISE EXCEPTION 'provider-plan critical path exceeds the immutable wall-clock policy'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."execution_envelope_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution envelope must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."execution_envelope_json") <> 23
     OR NOT (NEW."execution_envelope_json" ?& ARRAY[
       'schemaVersion', 'executionIntent', 'authority', 'envelopeId', 'jobId',
       'projectId', 'jobSpecSha256', 'providerPlanSha256',
       'reviewedIngestManifestSha256', 'intakeAdmissionResultSha256',
       'intakeStagingIndexSha256', 'executionPolicySha256', 'computeApprovalId',
       'providerKind', 'providerAdapterId', 'providerAdapterVersion',
       'providerAdapterArtifactSha256', 'providerDeploymentSha256',
       'pricingCurrency', 'pricingSnapshotSha256', 'pricingSnapshotExpiresAt',
       'createdAt', 'dispatchDeadline'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('executionIntent'), ('authority'), ('envelopeId'),
         ('jobId'), ('projectId'), ('jobSpecSha256'), ('providerPlanSha256'),
         ('reviewedIngestManifestSha256'), ('intakeAdmissionResultSha256'),
         ('intakeStagingIndexSha256'), ('executionPolicySha256'),
         ('providerKind'), ('providerAdapterId'), ('providerAdapterVersion'),
         ('providerAdapterArtifactSha256'), ('providerDeploymentSha256'),
         ('pricingCurrency'), ('pricingSnapshotSha256'),
         ('pricingSnapshotExpiresAt'), ('createdAt'), ('dispatchDeadline')
       ) string_leaf(key)
       WHERE jsonb_typeof(NEW."execution_envelope_json"->string_leaf.key)
               IS DISTINCT FROM 'string'
     )
     OR jsonb_typeof(NEW."execution_envelope_json"->'computeApprovalId')
          NOT IN ('null', 'string') THEN
    RAISE EXCEPTION 'execution envelope must use the exact closed V0 schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."execution_envelope_json"->>'schemaVersion'
       IS DISTINCT FROM 'omnitwin.foundry.execution-envelope.v0'
     OR NEW."schema_version" IS DISTINCT FROM 'omnitwin.foundry.execution-envelope.v0'
     OR NEW."execution_envelope_json"->>'executionIntent' IS DISTINCT FROM 'execute'
     OR NEW."execution_envelope_json"->>'authority' IS DISTINCT FROM 'none'
     OR NEW."execution_envelope_json"->>'envelopeId' IS DISTINCT FROM NEW."envelope_id"
     OR NEW."execution_envelope_json"->>'jobId' IS DISTINCT FROM NEW."job_id"
     OR NEW."execution_envelope_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
     OR NEW."execution_envelope_json"->>'jobSpecSha256'
       IS DISTINCT FROM NEW."job_spec_sha256"
     OR NEW."execution_envelope_json"->>'providerPlanSha256'
       IS DISTINCT FROM NEW."provider_plan_sha256"
     OR NEW."execution_envelope_json"->>'reviewedIngestManifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."execution_envelope_json"->>'intakeAdmissionResultSha256'
       IS DISTINCT FROM NEW."intake_admission_result_sha256"
     OR NEW."execution_envelope_json"->>'intakeStagingIndexSha256'
       IS DISTINCT FROM NEW."intake_staging_index_sha256"
     OR NEW."execution_envelope_json"->>'executionPolicySha256'
       IS DISTINCT FROM NEW."execution_policy_sha256"
     OR NEW."execution_envelope_json"->>'computeApprovalId'
       IS DISTINCT FROM NEW."compute_approval_id"
     OR NEW."execution_envelope_json"->>'providerKind' IS DISTINCT FROM NEW."provider_kind"
     OR NEW."execution_envelope_json"->>'providerAdapterId'
       IS DISTINCT FROM NEW."provider_adapter_id"
     OR NEW."execution_envelope_json"->>'providerAdapterVersion'
       IS DISTINCT FROM NEW."provider_adapter_version"
     OR NEW."execution_envelope_json"->>'providerAdapterArtifactSha256'
       IS DISTINCT FROM NEW."provider_adapter_artifact_sha256"
     OR NEW."execution_envelope_json"->>'providerDeploymentSha256'
       IS DISTINCT FROM NEW."provider_deployment_sha256"
     OR NEW."execution_envelope_json"->>'pricingCurrency' IS DISTINCT FROM 'USD'
     OR NEW."execution_envelope_json"->>'pricingSnapshotSha256'
       IS DISTINCT FROM NEW."pricing_snapshot_sha256"
     OR NEW."execution_envelope_json"->>'pricingSnapshotExpiresAt' IS DISTINCT FROM to_char(
       NEW."pricing_snapshot_expires_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."execution_envelope_json"->>'createdAt' IS DISTINCT FROM to_char(
       NEW."envelope_created_at" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."execution_envelope_json"->>'dispatchDeadline' IS DISTINCT FROM to_char(
       NEW."dispatch_deadline" AT TIME ZONE 'UTC',
       'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."execution_envelope_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.execution-envelope.v0', NEW."execution_envelope_json"
     )
     OR NEW."execution_policy_json" IS DISTINCT FROM bound_execution_policy_json THEN
    RAISE EXCEPTION 'execution envelope and policy JSON must bind the exact registered evidence'
      USING ERRCODE = '23514';
  END IF;
  IF job_created_at > NEW."provider_plan_planned_at"
     OR job_created_at > NEW."envelope_created_at"
     OR deployment_observed_at > NEW."provider_plan_planned_at"
     OR deployment_expires_at < NEW."dispatch_deadline" THEN
    RAISE EXCEPTION 'job, plan, deployment, and envelope evidence have an invalid chronology'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."dispatch_deadline" - NEW."envelope_created_at"
       > make_interval(secs => dispatch_window_ttl_seconds) THEN
    RAISE EXCEPTION 'job dispatch window exceeds the immutable policy maximum'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."pricing_snapshot_observed_at" > NEW."envelope_created_at"
     OR NEW."envelope_created_at" - NEW."pricing_snapshot_observed_at"
          > make_interval(secs => maximum_pricing_age_seconds) THEN
    RAISE EXCEPTION 'job pricing snapshot exceeds the immutable policy maximum age'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_rights_approval"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_job_spec jsonb;
  bound_job_created_at timestamptz;
  expected_job_subject_sha256 varchar(71);
BEGIN
  NEW."registered_at" := clock_timestamp();
  SELECT job."job_spec_json"
  INTO bound_job_spec
  FROM "foundry_jobs" job
  WHERE job."job_id" = NEW."job_id"
    AND job."project_id" = NEW."project_id"
    AND job."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND job."job_spec_sha256" = NEW."job_spec_sha256"
    AND job."reviewed_ingest_manifest_sha256" = NEW."reviewed_ingest_manifest_sha256"
    AND job."execution_policy_sha256" = NEW."execution_policy_sha256";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rights approval job subject is absent' USING ERRCODE = '23503';
  END IF;
  BEGIN
    bound_job_created_at := (bound_job_spec->>'createdAt')::timestamptz;
  EXCEPTION
    WHEN SQLSTATE '22007' OR SQLSTATE '22008' THEN
      RAISE EXCEPTION 'bound job createdAt is not a real UTC instant'
        USING ERRCODE = '23514';
  END;
  IF NEW."decided_at" < bound_job_created_at THEN
    RAISE EXCEPTION 'rights approval cannot predate its exact job subject'
      USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(NEW."rights_approval_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'rights approval must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."rights_approval_json") <> 9
     OR NOT (NEW."rights_approval_json" ?& ARRAY[
       'jobSubjectSha256', 'ingestManifestSha256', 'policyVersion',
       'policyDefinitionSha256', 'policyGeneration', 'decision',
       'decidedBy', 'decidedAt', 'expiresAt'
     ])
     OR jsonb_typeof(NEW."rights_approval_json"->'jobSubjectSha256')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'ingestManifestSha256')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'policyVersion')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'policyDefinitionSha256')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'policyGeneration')
          IS DISTINCT FROM 'number'
     OR jsonb_typeof(NEW."rights_approval_json"->'decision')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'decidedBy')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'decidedAt')
          IS DISTINCT FROM 'string'
     OR jsonb_typeof(NEW."rights_approval_json"->'expiresAt')
          IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'rights approval must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;

  IF (NEW."rights_approval_json"->'policyGeneration' #>> '{}')::numeric < 1
     OR (NEW."rights_approval_json"->'policyGeneration' #>> '{}')::numeric
          <> trunc((NEW."rights_approval_json"->'policyGeneration' #>> '{}')::numeric)
     OR (NEW."rights_approval_json"->'policyGeneration' #>> '{}')::numeric
          > 9007199254740991::numeric THEN
    RAISE EXCEPTION 'rights approval policy generation must be a positive safe integer'
      USING ERRCODE = '23514';
  END IF;

  expected_job_subject_sha256 := "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.job-approval-subject.v0', bound_job_spec
  );
  IF NEW."rights_approval_json"->>'jobSubjectSha256'
       IS DISTINCT FROM expected_job_subject_sha256
     OR NEW."rights_approval_json"->>'ingestManifestSha256'
       IS DISTINCT FROM NEW."reviewed_ingest_manifest_sha256"
     OR NEW."rights_approval_json"->>'policyVersion'
       IS DISTINCT FROM NEW."policy_version"
     OR NEW."rights_approval_json"->>'policyDefinitionSha256'
       IS DISTINCT FROM NEW."policy_definition_sha256"
     OR (NEW."rights_approval_json"->'policyGeneration' #>> '{}')::numeric
       IS DISTINCT FROM NEW."policy_generation"::numeric
     OR NEW."rights_approval_json"->>'decision' IS DISTINCT FROM NEW."decision"
     OR NEW."rights_approval_json"->>'decidedBy' IS DISTINCT FROM NEW."decided_by"
     OR NEW."rights_approval_json"->>'decidedAt' IS DISTINCT FROM to_char(
       NEW."decided_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."rights_approval_json"->>'expiresAt' IS DISTINCT FROM to_char(
       NEW."expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."rights_approval_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.rights-approval.v0', NEW."rights_approval_json"
     ) THEN
    RAISE EXCEPTION 'rights approval JSON and digest must bind the exact job and policy subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_compute_approval"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."registered_at" := clock_timestamp();
  IF jsonb_typeof(NEW."compute_approval_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'compute approval must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."compute_approval_json") <> 15
     OR NOT (NEW."compute_approval_json" ?& ARRAY[
       'schemaVersion', 'approvalId', 'executionEnvelopeSha256',
       'jobSpecSha256', 'jobId', 'projectId', 'providerKind',
       'providerAdapterId', 'providerAdapterVersion',
       'providerAdapterArtifactSha256', 'providerDeploymentSha256',
       'maximumCostMicroUsd', 'approvedBy', 'approvedAt', 'expiresAt'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('approvalId'), ('executionEnvelopeSha256'),
         ('jobSpecSha256'), ('jobId'), ('projectId'), ('providerKind'),
         ('providerAdapterId'), ('providerAdapterVersion'),
         ('providerAdapterArtifactSha256'), ('providerDeploymentSha256'),
         ('maximumCostMicroUsd'), ('approvedBy'), ('approvedAt'), ('expiresAt')
       ) string_leaf(key)
       WHERE jsonb_typeof(NEW."compute_approval_json"->string_leaf.key)
               IS DISTINCT FROM 'string'
     ) THEN
    RAISE EXCEPTION 'compute approval must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."compute_approval_json"->>'schemaVersion' IS DISTINCT FROM
       'omnitwin.foundry.execution-envelope-compute-approval.v0'
     OR NEW."compute_approval_json"->>'approvalId' IS DISTINCT FROM NEW."approval_id"
     OR NEW."compute_approval_json"->>'executionEnvelopeSha256'
       IS DISTINCT FROM NEW."execution_envelope_sha256"
     OR NEW."compute_approval_json"->>'jobSpecSha256'
       IS DISTINCT FROM NEW."job_spec_sha256"
     OR NEW."compute_approval_json"->>'jobId' IS DISTINCT FROM NEW."job_id"
     OR NEW."compute_approval_json"->>'projectId' IS DISTINCT FROM NEW."project_id"
     OR NEW."compute_approval_json"->>'providerKind' IS DISTINCT FROM NEW."provider_kind"
     OR NEW."compute_approval_json"->>'providerAdapterId'
       IS DISTINCT FROM NEW."provider_adapter_id"
     OR NEW."compute_approval_json"->>'providerAdapterVersion'
       IS DISTINCT FROM NEW."provider_adapter_version"
     OR NEW."compute_approval_json"->>'providerAdapterArtifactSha256'
       IS DISTINCT FROM NEW."provider_adapter_artifact_sha256"
     OR NEW."compute_approval_json"->>'providerDeploymentSha256'
       IS DISTINCT FROM NEW."provider_deployment_sha256"
     OR NEW."compute_approval_json"->>'maximumCostMicroUsd'
       IS DISTINCT FROM NEW."maximum_cost_micro_usd"::text
     OR NEW."compute_approval_json"->>'approvedBy' IS DISTINCT FROM NEW."approved_by"
     OR NEW."compute_approval_json"->>'approvedAt' IS DISTINCT FROM to_char(
       NEW."approved_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."compute_approval_json"->>'expiresAt' IS DISTINCT FROM to_char(
       NEW."expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."compute_approval_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.execution-envelope-compute-approval.v0',
       NEW."compute_approval_json"
     ) THEN
    RAISE EXCEPTION 'compute approval JSON and digest must bind the exact envelope subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_execution_confirmation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."registered_at" := clock_timestamp();
  IF jsonb_typeof(NEW."confirmation_json") IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'execution confirmation must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF "foundry_jsonb_object_key_count"(NEW."confirmation_json") <> 8
     OR NOT (NEW."confirmation_json" ?& ARRAY[
       'schemaVersion', 'confirmationId', 'executionEnvelopeSha256',
       'jobSpecSha256', 'jobId', 'confirmedBy', 'confirmedAt', 'expiresAt'
     ])
     OR EXISTS (
       SELECT 1
       FROM (VALUES
         ('schemaVersion'), ('confirmationId'), ('executionEnvelopeSha256'),
         ('jobSpecSha256'), ('jobId'), ('confirmedBy'), ('confirmedAt'), ('expiresAt')
       ) string_leaf(key)
       WHERE jsonb_typeof(NEW."confirmation_json"->string_leaf.key)
               IS DISTINCT FROM 'string'
     ) THEN
    RAISE EXCEPTION 'execution confirmation must use the exact closed JSON schema'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."confirmation_json"->>'schemaVersion' IS DISTINCT FROM
       'omnitwin.foundry.execution-envelope-confirmation.v0'
     OR NEW."confirmation_json"->>'confirmationId'
       IS DISTINCT FROM NEW."confirmation_id"
     OR NEW."confirmation_json"->>'executionEnvelopeSha256'
       IS DISTINCT FROM NEW."execution_envelope_sha256"
     OR NEW."confirmation_json"->>'jobSpecSha256'
       IS DISTINCT FROM NEW."job_spec_sha256"
     OR NEW."confirmation_json"->>'jobId' IS DISTINCT FROM NEW."job_id"
     OR NEW."confirmation_json"->>'confirmedBy' IS DISTINCT FROM NEW."confirmed_by"
     OR NEW."confirmation_json"->>'confirmedAt' IS DISTINCT FROM to_char(
       NEW."confirmed_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."confirmation_json"->>'expiresAt' IS DISTINCT FROM to_char(
       NEW."expires_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
     )
     OR NEW."confirmation_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
       'omnitwin.foundry.execution-envelope-confirmation.v0', NEW."confirmation_json"
     ) THEN
    RAISE EXCEPTION 'execution confirmation JSON and digest must bind the exact envelope subject'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_provider_request_profile"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact_reviewed_at timestamptz;
  artifact_expires_at timestamptz;
  deployment_observed_at timestamptz;
  deployment_expires_at timestamptz;
BEGIN
  NEW."registered_at" := clock_timestamp();
  SELECT artifact."reviewed_at", artifact."expires_at",
         deployment."observed_at", deployment."expires_at"
  INTO artifact_reviewed_at, artifact_expires_at,
       deployment_observed_at, deployment_expires_at
  FROM "foundry_provider_adapter_artifacts" artifact
  JOIN "foundry_provider_deployments" deployment
    ON deployment."provider_deployment_sha256" = NEW."provider_deployment_sha256"
   AND deployment."provider_kind" = NEW."provider_kind"
   AND deployment."provider_adapter_id" = NEW."provider_adapter_id"
   AND deployment."provider_adapter_version" = NEW."provider_adapter_version"
   AND deployment."provider_adapter_artifact_sha256" =
         NEW."provider_adapter_artifact_sha256"
  WHERE artifact."provider_adapter_artifact_sha256" =
          NEW."provider_adapter_artifact_sha256"
    AND artifact."provider_kind" = NEW."provider_kind"
    AND artifact."provider_adapter_id" = NEW."provider_adapter_id"
    AND artifact."provider_adapter_version" = NEW."provider_adapter_version";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider request profile parent artifact or deployment is absent'
      USING ERRCODE = '23503';
  END IF;
  IF NEW."reviewed_at" < GREATEST(artifact_reviewed_at, deployment_observed_at)
     OR NEW."expires_at" > LEAST(artifact_expires_at, deployment_expires_at) THEN
    RAISE EXCEPTION 'provider request profile validity must remain within its exact artifact and deployment evidence windows'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(NEW."profile_json") IS DISTINCT FROM 'object'
     OR jsonb_typeof(NEW."profile_json"->'allowedContainerImages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."profile_json"->'allowedNetworkAccess') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."profile_json"->'allowedCapacityClasses') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."profile_json"->'allowedObjectStorageProfiles') IS DISTINCT FROM 'array'
     OR jsonb_typeof(NEW."profile_json"->'supportedCommandKinds') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'provider request profile allowlists must be arrays'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(NEW."profile_json"->'allowedContainerImages') NOT BETWEEN 1 AND 1000
     OR jsonb_array_length(NEW."profile_json"->'allowedNetworkAccess') NOT BETWEEN 1 AND 3
     OR jsonb_array_length(NEW."profile_json"->'allowedCapacityClasses') NOT BETWEEN 1 AND 1000
     OR jsonb_array_length(NEW."profile_json"->'allowedObjectStorageProfiles') NOT BETWEEN 0 AND 1000
     OR jsonb_array_length(NEW."profile_json"->'supportedCommandKinds') NOT BETWEEN 4 AND 5 THEN
    RAISE EXCEPTION 'provider request profile allowlists exceed their bounded schema'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."profile_json"->'allowedContainerImages') image(value)
    WHERE char_length(image.value) > 512
       OR image.value !~ '^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$'
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."profile_json"->'allowedNetworkAccess') network(value)
    WHERE network.value NOT IN ('none', 'object_storage_only', 'restricted')
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."profile_json"->'allowedCapacityClasses') capacity(value)
    WHERE capacity.value !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."profile_json"->'allowedObjectStorageProfiles') storage(value)
    WHERE storage.value !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
  ) OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(NEW."profile_json"->'supportedCommandKinds') command_kind(value)
    WHERE command_kind.value NOT IN (
      'provider_submit', 'provider_reconcile', 'provider_poll',
      'provider_checkpoint', 'provider_stop'
    )
  ) OR (
    NEW."provider_kind" = 'runpod'
    AND NEW."profile_json"->'supportedCommandKinds' @> '["provider_checkpoint"]'::jsonb
  ) OR NOT (NEW."profile_json"->'supportedCommandKinds' @> '["provider_submit"]'::jsonb)
    OR NOT (NEW."profile_json"->'supportedCommandKinds' @> '["provider_reconcile"]'::jsonb)
    OR NOT (NEW."profile_json"->'supportedCommandKinds' @> '["provider_poll"]'::jsonb)
    OR NOT (NEW."profile_json"->'supportedCommandKinds' @> '["provider_stop"]'::jsonb) THEN
    RAISE EXCEPTION 'provider request profile contains an invalid image, allowlist, or command set'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_job_worker_profile"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_profile_count integer;
  existing_profile_count bigint;
  job_provider_kind varchar(40);
  job_spec_json jsonb;
  job_provider_plan_json jsonb;
  job_plan_time timestamptz;
  job_dispatch_deadline timestamptz;
  job_registered_at timestamptz;
  profile_reviewed_at timestamptz;
  profile_expires_at timestamptz;
  profile_registered_at timestamptz;
  profile_local_allowed boolean;
BEGIN
  SELECT j."trusted_worker_profile_count", j."provider_kind", j."job_spec_json",
         j."provider_plan_json", j."provider_plan_planned_at",
         j."dispatch_deadline", j."registered_at"
  INTO expected_profile_count, job_provider_kind, job_spec_json,
       job_provider_plan_json, job_plan_time, job_dispatch_deadline,
       job_registered_at
  FROM "foundry_jobs" j
  WHERE j."job_id" = NEW."job_id"
    AND j."project_id" = NEW."project_id"
    AND j."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND j."provider_plan_sha256" = NEW."provider_plan_sha256"
    AND j."trusted_worker_profile_set_sha256" = NEW."trusted_worker_profile_set_sha256"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'job worker-profile set is absent' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "foundry_executions" e
    WHERE e."job_id" = NEW."job_id" AND e."project_id" = NEW."project_id"
  ) THEN
    RAISE EXCEPTION 'job worker-profile bindings are frozen after execution admission' USING ERRCODE = '55000';
  END IF;
  SELECT wp."reviewed_at", wp."expires_at", wp."registered_at", wp."local_execution_allowed"
  INTO profile_reviewed_at, profile_expires_at, profile_registered_at, profile_local_allowed
  FROM "foundry_trusted_worker_profiles" wp
  WHERE wp."worker_profile_sha256" = NEW."worker_profile_sha256"
    AND wp."operation_class" = NEW."operation_class";
  IF NOT FOUND
     OR profile_reviewed_at > job_plan_time
     OR profile_expires_at < job_dispatch_deadline
     OR profile_registered_at > NEW."registered_at"
     OR job_registered_at > NEW."registered_at"
     OR (job_provider_kind IN ('local_cpu', 'local_cuda') AND NOT profile_local_allowed) THEN
    RAISE EXCEPTION 'worker profile is not valid for the exact job plan and dispatch window' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(job_provider_plan_json->'stages') plan_stage(value)
    JOIN LATERAL jsonb_array_elements(job_spec_json->'stages') job_stage(value)
      ON job_stage.value->>'id' = plan_stage.value->>'stageId'
    JOIN "foundry_trusted_worker_profiles" worker_profile
      ON worker_profile."worker_profile_sha256" = NEW."worker_profile_sha256"
     AND worker_profile."operation_class" = NEW."operation_class"
     AND worker_profile."container_image" = job_stage.value->>'containerImage'
     AND worker_profile."network_access" = job_stage.value->>'networkAccess'
     AND worker_profile."profile_json"->'command' = job_stage.value->'command'
    WHERE plan_stage.value->>'stageId' = NEW."stage_id"
      AND plan_stage.value->>'workerProfileSha256' = NEW."worker_profile_sha256"
      AND job_stage.value->'rightsPurposes' @> jsonb_build_array(
        CASE NEW."operation_class"
          WHEN 'read_only_inspection' THEN 'commercial_internal_use'
          WHEN 'deterministic_transformation' THEN 'commercial_internal_use'
          WHEN 'model_inference' THEN 'commercial_internal_use'
          WHEN 'model_training' THEN 'model_training'
          WHEN 'redistribution_packaging' THEN 'redistribution'
          WHEN 'public_release' THEN 'public_release'
        END
      )
  ) THEN
    RAISE EXCEPTION 'job worker-profile binding does not match its exact plan stage and operation'
      USING ERRCODE = '23514';
  END IF;
  SELECT count(DISTINCT jwp."worker_profile_sha256")
  INTO existing_profile_count
  FROM "foundry_job_worker_profiles" jwp
  WHERE jwp."job_id" = NEW."job_id"
    AND jwp."project_id" = NEW."project_id"
    AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND jwp."provider_plan_sha256" = NEW."provider_plan_sha256"
    AND jwp."trusted_worker_profile_set_sha256" = NEW."trusted_worker_profile_set_sha256";
  IF existing_profile_count + (
       CASE WHEN EXISTS (
         SELECT 1 FROM "foundry_job_worker_profiles" jwp
         WHERE jwp."job_id" = NEW."job_id"
           AND jwp."worker_profile_sha256" = NEW."worker_profile_sha256"
       ) THEN 0 ELSE 1 END
     ) > expected_profile_count THEN
    RAISE EXCEPTION 'job worker-profile set exceeds its immutable digest count' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_stop_intent"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  intent_now timestamptz;
  attempt_state varchar(40);
  wall_clock_deadline timestamptz;
  cancel_deadline timestamptz;
  termination_deadline timestamptz;
  worker_self_deadline timestamptz;
  provider_ttl_deadline timestamptz;
  selected_deadline timestamptz;
  submit_invoked boolean;
  source_ok boolean;
  source_scope varchar(20);
  source_digest varchar(71);
  source_recorded_at timestamptz;
  source_actor_kind varchar(30);
  source_actor_key varchar(160);
  source_actor_user_id uuid;
BEGIN
  intent_now := clock_timestamp();
  NEW."recorded_at" := intent_now;
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  SELECT a."state", a."wall_clock_deadline",
         a."cancel_deadline", a."termination_deadline", a."worker_self_deadline",
         a."provider_ttl_deadline"
  INTO attempt_state, wall_clock_deadline,
       cancel_deadline, termination_deadline, worker_self_deadline,
       provider_ttl_deadline
  FROM "foundry_attempts" a
  JOIN "foundry_executions" e ON e."id" = a."execution_id"
  WHERE a."id" = NEW."attempt_id"
    AND a."execution_id" = NEW."execution_id"
    AND a."project_id" = NEW."project_id"
    AND a."job_id" = NEW."job_id"
    AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND a."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND a."provider_kind" = NEW."provider_kind"
    AND a."provider_adapter_id" = NEW."provider_adapter_id"
    AND a."provider_adapter_version" = NEW."provider_adapter_version"
    AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND a."attempt_ordinal" = NEW."attempt_ordinal"
    AND a."fencing_token" = NEW."fencing_token"
    AND e."fencing_token" = NEW."fencing_token"
  FOR UPDATE OF a, e;
  IF NOT FOUND OR left(attempt_state, 9) = 'terminal_' THEN
    RAISE EXCEPTION 'stop intent requires the exact live fenced attempt'
      USING ERRCODE = '55000';
  END IF;

  CASE NEW."source_kind"
    WHEN 'operator_request' THEN
      IF NEW."reason_code" <> 'operator_cancel'
         OR NEW."actor_kind" <> 'operator' THEN
        RAISE EXCEPTION 'operator stop intent requires an authenticated operator cancellation source'
          USING ERRCODE = '23514';
      END IF;
      SELECT true, ev."request_digest", ev."recorded_at", ev."actor_kind",
             ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_kind,
           source_actor_key, source_actor_user_id
      FROM "foundry_execution_events" ev
      WHERE ev."id" = NEW."source_id"
        AND ev."execution_id" = NEW."execution_id"
        AND ev."attempt_id" = NEW."attempt_id"
        AND ev."fencing_token" = NEW."fencing_token"
        AND ev."event_kind" = 'operator_cancel_requested'
        AND NOT ev."advances_projection"
        AND ev."payload"->>'reasonCode' = NEW."reason_code";
      IF source_ok IS DISTINCT FROM true
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'operator stop intent does not exactly bind its append-only cancellation request'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'runtime_watchdog' THEN
      IF NEW."actor_kind" NOT IN ('service', 'watchdog', 'system')
      THEN
        RAISE EXCEPTION 'runtime stop intent requires a trusted watchdog actor'
          USING ERRCODE = '23514';
      END IF;
      selected_deadline := CASE NEW."reason_code"
        WHEN 'wall_clock_deadline' THEN wall_clock_deadline
        WHEN 'cancel_deadline' THEN cancel_deadline
        WHEN 'termination_deadline' THEN termination_deadline
        WHEN 'worker_self_deadline' THEN worker_self_deadline
        WHEN 'provider_ttl_deadline' THEN provider_ttl_deadline
        ELSE NULL
      END;
      IF selected_deadline IS NULL OR selected_deadline > intent_now THEN
        RAISE EXCEPTION 'runtime stop intent cannot precede its exact immutable deadline'
          USING ERRCODE = '55000';
      END IF;
      SELECT true, ev."request_digest", ev."recorded_at", ev."actor_kind",
             ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_kind,
           source_actor_key, source_actor_user_id
      FROM "foundry_execution_events" ev
      WHERE ev."id" = NEW."source_id"
        AND ev."execution_id" = NEW."execution_id"
        AND ev."attempt_id" = NEW."attempt_id"
        AND ev."fencing_token" = NEW."fencing_token"
        AND ev."event_kind" = 'runtime_deadline_elapsed'
        AND NOT ev."advances_projection"
        AND ev."payload"->>'reasonCode' = NEW."reason_code"
        AND (ev."payload"->>'deadline')::timestamptz IS NOT DISTINCT FROM selected_deadline;
      IF source_ok IS DISTINCT FROM true
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'runtime stop intent does not exactly bind its append-only elapsed-deadline event'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'kill_switch_event' THEN
      SELECT true, k."scope", ev."request_digest", ev."recorded_at",
             ev."actor_kind", ev."actor_key", ev."actor_user_id"
      INTO source_ok, source_scope, source_digest, source_recorded_at,
           source_actor_kind, source_actor_key, source_actor_user_id
      FROM "foundry_kill_switch_events" ev
      JOIN "foundry_kill_switches" k ON k."id" = ev."kill_switch_id"
      WHERE ev."id" = NEW."source_id"
        AND ev."action" = 'activate'
        AND ev."resulting_revision" = k."revision"
        AND k."state" = 'active'
        AND (
          k."scope" = 'global'
          OR (k."scope" = 'provider'
            AND k."provider_kind" = NEW."provider_kind"
            AND k."provider_adapter_id" = NEW."provider_adapter_id"
            AND k."provider_adapter_version" = NEW."provider_adapter_version")
          OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
          OR (k."scope" = 'execution' AND k."execution_id" = NEW."execution_id")
          OR (k."scope" = 'attempt' AND k."attempt_id" = NEW."attempt_id")
        );
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" IS DISTINCT FROM 'kill_' || source_scope
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'kill stop intent does not exactly bind the active kill-switch event and scope'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'rights_policy_revocation' THEN
      SELECT true, r."request_digest", r."recorded_at", r."revoked_by_user_id"
      INTO source_ok, source_digest, source_recorded_at, source_actor_user_id
      FROM "foundry_rights_policy_revocations" r
      JOIN "foundry_executions" e
        ON e."id" = NEW."execution_id"
       AND e."rights_policy_version" = r."policy_version"
       AND e."rights_policy_definition_sha256" = r."policy_definition_sha256"
       AND e."rights_policy_generation" = r."policy_generation"
      WHERE r."id" = NEW."source_id";
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" <> 'rights_revoked'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" <> 'operator'
         OR NEW."actor_user_id" IS DISTINCT FROM source_actor_user_id THEN
        RAISE EXCEPTION 'rights stop intent does not exactly bind its policy revocation'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'cost_observation' THEN
      SELECT true, c."request_digest", c."recorded_at", c."recorded_by"
      INTO source_ok, source_digest, source_recorded_at, source_actor_key
      FROM "foundry_cost_observations" c
      JOIN "foundry_executions" e ON e."id" = c."execution_id"
      WHERE c."id" = NEW."source_id"
        AND c."attempt_id" = NEW."attempt_id"
        AND c."fencing_token" = NEW."fencing_token"
        AND e."total_cost_micro_usd" >= e."cost_hard_stop_micro_usd";
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" <> 'cost_hard_stop'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" <> 'service'
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS NOT NULL THEN
        RAISE EXCEPTION 'cost stop intent does not exactly bind the hard-stop observation'
          USING ERRCODE = '23514';
      END IF;
    WHEN 'provider_command' THEN
      SELECT true, c."outcome_sha256", c."completed_at",
             c."completed_by_actor_kind", c."completed_by_actor_key"
      INTO source_ok, source_digest, source_recorded_at,
           source_actor_kind, source_actor_key
      FROM "foundry_provider_commands" c
      WHERE c."id" = NEW."source_id"
        AND c."execution_id" = NEW."execution_id"
        AND c."attempt_id" = NEW."attempt_id"
        AND c."fencing_token" = NEW."fencing_token"
        AND c."command_kind" = 'provider_checkpoint'
        AND c."state" = 'uncertain'
        AND c."provider_lifecycle_state" = 'unknown';
      IF source_ok IS DISTINCT FROM true
         OR NEW."reason_code" <> 'checkpoint_effect_unknown'
         OR NEW."source_digest" IS DISTINCT FROM source_digest
         OR NEW."source_recorded_at" IS DISTINCT FROM source_recorded_at
         OR NEW."actor_kind" IS DISTINCT FROM source_actor_kind
         OR NEW."actor_key" IS DISTINCT FROM source_actor_key
         OR NEW."actor_user_id" IS NOT NULL THEN
        RAISE EXCEPTION 'checkpoint-unknown stop intent does not exactly bind its terminal provider command'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      RAISE EXCEPTION 'unsupported stop-intent source kind' USING ERRCODE = '23514';
  END CASE;

  SELECT EXISTS (
    SELECT 1
    FROM "foundry_execution_events" ev
    WHERE ev."attempt_id" = NEW."attempt_id"
      AND ev."fencing_token" = NEW."fencing_token"
      AND ev."event_kind" = 'provider_invocation_started'
      AND ev."provider_command_kind" = 'provider_submit'
  ) INTO submit_invoked;

  IF attempt_state IN ('authorized', 'validating')
     OR (attempt_state = 'submit_pending' AND NOT submit_invoked) THEN
    UPDATE "foundry_attempts"
    SET "state" = NEW."target_terminal_state",
        "cancel_requested" = true,
        "finished_at" = intent_now,
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(intent_now, "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."attempt_id" AND "fencing_token" = NEW."fencing_token";
  ELSIF attempt_state NOT IN ('stop_pending', 'terminating', 'termination_unconfirmed') THEN
    UPDATE "foundry_attempts"
    SET "state" = 'stop_pending',
        "cancel_requested" = true,
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(intent_now, "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."attempt_id" AND "fencing_token" = NEW."fencing_token";
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "apply_foundry_stop_intent_outbox_cancellation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  WITH cancellable AS (
    SELECT c."id"
    FROM "foundry_provider_commands" c
    JOIN "foundry_attempts" a
      ON a."id" = c."attempt_id"
     AND a."fencing_token" = c."fencing_token"
    WHERE c."attempt_id" = NEW."attempt_id"
      AND c."fencing_token" = NEW."fencing_token"
      AND c."state" = 'pending'
      AND a."cancel_requested"
      AND (
        left(a."state", 9) = 'terminal_'
        OR c."command_kind" = 'provider_checkpoint'
        OR (
          c."command_kind" = 'provider_reconcile'
          AND a."provider_execution_ref" IS NOT NULL
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_execution_events" invocation
        WHERE invocation."provider_command_id" = c."id"
          AND invocation."event_kind" = 'provider_invocation_started'
      )
    FOR UPDATE OF c SKIP LOCKED
  )
  UPDATE "foundry_provider_commands" c
  SET "state" = 'cancelled',
      "cancelled_by_stop_intent_id" = NEW."id",
      "revision" = c."revision" + 1,
      "updated_at" = GREATEST(clock_timestamp(), c."updated_at" + interval '1 microsecond')
  FROM cancellable
  WHERE c."id" = cancellable."id";
  RETURN NEW;
END;
$$;

CREATE FUNCTION "append_foundry_stop_intent_application_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_payload jsonb;
  next_event_sequence bigint;
  prior_event_revision bigint;
  current_execution_revision bigint;
  projection_delta bigint;
BEGIN
  SELECT execution."revision" INTO STRICT current_execution_revision
  FROM "foundry_executions" execution
  WHERE execution."id" = NEW."execution_id";
  SELECT COALESCE(max(event."sequence"), 0) + 1,
         COALESCE(max(event."resulting_revision"), 0)
  INTO next_event_sequence, prior_event_revision
  FROM "foundry_execution_events" event
  WHERE event."execution_id" = NEW."execution_id";
  projection_delta := current_execution_revision - prior_event_revision;
  IF projection_delta NOT IN (0, 1) THEN
    RAISE EXCEPTION 'stop intent cannot close more than one unapplied execution projection revision'
      USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.stop-intent-applied.v0',
    'stopIntentId', NEW."id"::text,
    'reasonCode', NEW."reason_code",
    'targetTerminalState', NEW."target_terminal_state",
    'sourceKind', NEW."source_kind",
    'sourceId', NEW."source_id"::text,
    'sourceDigest', NEW."source_digest",
    'attemptState', attempt."state",
    'cancelRequested', attempt."cancel_requested"
  ) INTO STRICT event_payload
  FROM "foundry_attempts" attempt
  WHERE attempt."id" = NEW."attempt_id"
    AND attempt."execution_id" = NEW."execution_id"
    AND attempt."fencing_token" = NEW."fencing_token";

  INSERT INTO "foundry_execution_events" (
    "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "execution_subject_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
    "sequence", "event_kind", "advances_projection", "payload", "actor_kind",
    "actor_key", "actor_user_id", "idempotency_key", "causation_id",
    "correlation_id", "expected_revision", "resulting_revision", "request_digest",
    "recorded_at"
  ) VALUES (
    NEW."execution_id", NEW."project_id", NEW."job_id",
    NEW."execution_envelope_sha256", NEW."execution_subject_sha256",
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."attempt_id", NEW."attempt_ordinal", NEW."fencing_token",
    next_event_sequence, 'stop_intent_applied', projection_delta = 1, event_payload,
    NEW."actor_kind", NEW."actor_key", NEW."actor_user_id",
    'stop-intent-applied:' || NEW."id"::text, NEW."id", NEW."correlation_id",
    prior_event_revision, prior_event_revision + projection_delta,
    "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.stop-intent-applied.v0', event_payload
    ), NEW."recorded_at"
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION "guard_foundry_prepared_provider_request"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_state varchar(40);
  attempt_provider_execution_ref varchar(240);
  attempt_cancel_requested boolean;
  rights_policy_version varchar(120);
  expected_sequence bigint;
  expected_stages jsonb;
  expected_stage_ids jsonb;
  expected_rights_stage_purposes jsonb;
  expected_action jsonb;
  expected_authorization jsonb;
  execution_row "foundry_executions"%ROWTYPE;
  job_row "foundry_jobs"%ROWTYPE;
  deployment_row "foundry_provider_deployments"%ROWTYPE;
  profile_row "foundry_provider_request_profiles"%ROWTYPE;
  policy_row "foundry_execution_policies"%ROWTYPE;
  originating_submit "foundry_provider_commands"%ROWTYPE;
  critical_path_seconds numeric;
BEGIN
  NEW."prepared_at" := date_trunc('milliseconds', transaction_timestamp());
  SELECT e."rights_policy_version" INTO rights_policy_version
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared provider request execution scope is absent' USING ERRCODE = '23503';
  END IF;
  PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  SELECT a."state", a."provider_execution_ref", a."cancel_requested"
  INTO attempt_state, attempt_provider_execution_ref, attempt_cancel_requested
  FROM "foundry_attempts" a
  WHERE a."id" = NEW."attempt_id"
    AND a."execution_id" = NEW."execution_id"
    AND a."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND a."fencing_token" = NEW."fencing_token"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared provider request attempt scope is absent' USING ERRCODE = '23503';
  END IF;
  SELECT e.* INTO execution_row
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id"
    AND e."project_id" = NEW."project_id"
    AND e."job_id" = NEW."job_id"
    AND e."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND e."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND e."provider_kind" = NEW."provider_kind"
    AND e."provider_adapter_id" = NEW."provider_adapter_id"
    AND e."provider_adapter_version" = NEW."provider_adapter_version"
    AND e."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND e."provider_deployment_sha256" = NEW."provider_deployment_sha256"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'prepared provider request execution binding is absent' USING ERRCODE = '23503';
  END IF;
  SELECT j.* INTO STRICT job_row FROM "foundry_jobs" j WHERE j."job_id" = NEW."job_id";
  SELECT d.* INTO STRICT deployment_row
  FROM "foundry_provider_deployments" d
  WHERE d."provider_deployment_sha256" = NEW."provider_deployment_sha256";
  SELECT p.* INTO STRICT profile_row
  FROM "foundry_provider_request_profiles" p
  WHERE p."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
    AND p."profile_id" = NEW."provider_request_profile_id"
    AND p."profile_version" = NEW."provider_request_profile_version"
    AND p."provider_kind" = NEW."provider_kind"
    AND p."provider_adapter_id" = NEW."provider_adapter_id"
    AND p."provider_adapter_version" = NEW."provider_adapter_version"
    AND p."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND p."provider_adapter_configuration_sha256" =
          NEW."provider_adapter_configuration_sha256"
    AND p."provider_deployment_sha256" = NEW."provider_deployment_sha256";
  SELECT p.* INTO STRICT policy_row
  FROM "foundry_execution_policies" p
  WHERE p."execution_policy_sha256" = execution_row."execution_policy_sha256";
  SELECT COALESCE(MAX(c."command_sequence"), 0) + 1 INTO expected_sequence
  FROM "foundry_provider_commands" c
  WHERE c."attempt_id" = NEW."attempt_id";
  IF NEW."command_sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'prepared provider request must reserve the next exact command sequence'
      USING ERRCODE = '40001';
  END IF;
  IF NEW."provider_idempotency_key" IS DISTINCT FROM (
       'foundry-' || substr(NEW."execution_subject_sha256", 8, 16) || '-'
         || substr(replace(NEW."attempt_id"::text, '-', ''), 1, 16)
     ) THEN
    RAISE EXCEPTION 'provider idempotency key must derive from the exact subject and attempt'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."provider_client_request_id" IS DISTINCT FROM (
       'foundry-' || replace(NEW."command_kind", 'provider_', '') || '-'
         || replace(NEW."provider_command_id"::text, '-', '')
     ) THEN
    RAISE EXCEPTION 'provider client request id must derive from the exact command kind and id'
      USING ERRCODE = '23514';
  END IF;
  IF NOT (profile_row."profile_json"->'supportedCommandKinds' @>
          jsonb_build_array(NEW."command_kind")) THEN
    RAISE EXCEPTION 'provider request profile does not support this command kind'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."maximum_api_call_seconds" <> profile_row."maximum_api_call_seconds" THEN
    RAISE EXCEPTION 'provider API deadline must equal the immutable request profile'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."command_kind" = 'provider_submit' AND attempt_state <> 'authorized' THEN
    RAISE EXCEPTION 'provider submit request may be prepared only for an authorized attempt'
      USING ERRCODE = '55000';
  ELSIF NEW."command_kind" <> 'provider_submit' AND attempt_state NOT IN (
    'provider_unknown', 'queued', 'running', 'checkpointing', 'stop_pending',
    'terminating', 'termination_unconfirmed', 'validating'
  ) THEN
    RAISE EXCEPTION 'provider follow-up request requires a provider-bound attempt'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" IN ('provider_submit', 'provider_checkpoint') AND (
       profile_row."reviewed_at" > NEW."prepared_at"
       OR profile_row."expires_at" <= NEW."prepared_at"
       OR (
         NEW."command_kind" = 'provider_checkpoint'
         AND profile_row."expires_at" <= NEW."prepared_at" + make_interval(
           secs => NEW."maximum_api_call_seconds" + 1
         )
       )
     ) THEN
    RAISE EXCEPTION 'provider launch or checkpoint requires a currently valid immutable request profile'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" = 'provider_submit'
     AND profile_row."expires_at" < execution_row."dispatch_deadline" THEN
    RAISE EXCEPTION 'provider submit request profile must remain valid through the dispatch deadline'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" <> 'provider_submit' AND NOT EXISTS (
    SELECT 1
    FROM "foundry_provider_commands" submit_command
    WHERE submit_command."attempt_id" = NEW."attempt_id"
      AND submit_command."fencing_token" = NEW."fencing_token"
      AND submit_command."command_kind" = 'provider_submit'
      AND submit_command."command_sequence" < NEW."command_sequence"
      AND submit_command."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
      AND submit_command."provider_adapter_configuration_sha256" =
            NEW."provider_adapter_configuration_sha256"
      AND submit_command."provider_idempotency_key" = NEW."provider_idempotency_key"
  ) THEN
    RAISE EXCEPTION 'provider follow-up must retain the original submit profile and idempotency identity'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."command_kind" = 'provider_stop'
     AND attempt_provider_execution_ref IS NULL THEN
    RAISE EXCEPTION 'provider stop request requires an exact provider resource reference'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" = 'provider_stop'
     AND (
       attempt_state NOT IN ('stop_pending', 'termination_unconfirmed')
       OR NOT attempt_cancel_requested
     ) THEN
    RAISE EXCEPTION 'provider stop preparation requires an exact live containment projection'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" = 'provider_checkpoint'
     AND (
       attempt_state <> 'running'
       OR attempt_cancel_requested
     ) THEN
    RAISE EXCEPTION 'provider checkpoint preparation is blocked outside live non-cancelled execution'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."command_kind" = 'provider_checkpoint' AND (
       NOT "foundry_rights_policy_is_active"(
         execution_row."rights_policy_version",
         execution_row."rights_policy_definition_sha256",
         execution_row."rights_policy_generation",
         NEW."prepared_at" + make_interval(
           secs => NEW."maximum_api_call_seconds" + 1
         )
       ) OR NOT EXISTS (
         SELECT 1 FROM "foundry_rights_approvals" r
         WHERE r."id" = execution_row."rights_approval_id"
           AND r."rights_approval_sha256" = execution_row."rights_approval_sha256"
           AND r."expires_at" > NEW."prepared_at" + make_interval(
                 secs => NEW."maximum_api_call_seconds" + 1
               )
       )
     ) THEN
    RAISE EXCEPTION 'provider checkpoint requires live rights approval and policy generation'
      USING ERRCODE = '55000';
  END IF;

  IF jsonb_typeof(job_row."job_spec_json"->'stages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(job_row."provider_plan_json"->'stages') IS DISTINCT FROM 'array'
     OR jsonb_typeof(deployment_row."deployment_json"->'capacityClasses')
          IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'job, provider plan, and deployment stage sources must be bounded arrays'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(job_row."job_spec_json"->'stages') NOT BETWEEN 1 AND 1000
     OR jsonb_array_length(job_row."provider_plan_json"->'stages') NOT BETWEEN 1 AND 1000
     OR jsonb_array_length(deployment_row."deployment_json"->'capacityClasses')
          NOT BETWEEN 1 AND 1000
     OR jsonb_array_length(job_row."provider_plan_json"->'stages') <>
          jsonb_array_length(job_row."job_spec_json"->'stages')
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(job_row."job_spec_json"->'stages') stage(value)
       WHERE jsonb_typeof(stage.value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(stage.value->'id') IS DISTINCT FROM 'string'
          OR CASE WHEN jsonb_typeof(stage.value) = 'object' THEN
               "foundry_jsonb_object_key_count"(stage.value) <> 16
               OR NOT (stage.value ?& ARRAY[
                 'id', 'kind', 'dependsOn', 'containerImage', 'command',
                 'inputAssetIds', 'outputNames', 'rightsPurposes', 'cpuCores',
                 'ramGiB', 'gpuCount', 'minimumGpuVramGiB', 'scratchGiB',
                 'networkAccess', 'checkpoint', 'resumable'
               ])
             ELSE false END
     )
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(job_row."provider_plan_json"->'stages') stage(value)
       WHERE jsonb_typeof(stage.value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(stage.value->'stageId') IS DISTINCT FROM 'string'
          OR CASE WHEN jsonb_typeof(stage.value) = 'object' THEN
               "foundry_jsonb_object_key_count"(stage.value) <> 5
               OR NOT (stage.value ?& ARRAY[
                 'stageId', 'capacityClass', 'workerProfileSha256',
                 'estimatedCostMicroUsd', 'maximumRuntimeSeconds'
               ])
             ELSE false END
     )
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(deployment_row."deployment_json"->'capacityClasses') capacity(value)
       WHERE jsonb_typeof(capacity.value) IS DISTINCT FROM 'object'
          OR jsonb_typeof(capacity.value->'id') IS DISTINCT FROM 'string'
     )
     OR (
       SELECT count(*) <> count(DISTINCT stage.value->>'id')
       FROM jsonb_array_elements(job_row."job_spec_json"->'stages') stage(value)
     )
     OR (
       SELECT count(*) <> count(DISTINCT stage.value->>'stageId')
       FROM jsonb_array_elements(job_row."provider_plan_json"->'stages') stage(value)
     )
     OR (
       SELECT count(*) <> count(DISTINCT capacity.value->>'id')
       FROM jsonb_array_elements(deployment_row."deployment_json"->'capacityClasses') capacity(value)
     )
     OR job_row."provider_plan_json"->'stages' IS DISTINCT FROM (
       SELECT jsonb_agg(stage.value ORDER BY stage.value->>'stageId' COLLATE "C")
       FROM jsonb_array_elements(job_row."provider_plan_json"->'stages') stage(value)
     )
     OR deployment_row."deployment_json"->'capacityClasses' IS DISTINCT FROM (
       SELECT jsonb_agg(capacity.value ORDER BY capacity.value->>'id' COLLATE "C")
       FROM jsonb_array_elements(
         deployment_row."deployment_json"->'capacityClasses'
       ) capacity(value)
     ) THEN
    RAISE EXCEPTION 'job, provider plan, and deployment sources must have bounded unique stage keys'
      USING ERRCODE = '23514';
  END IF;
  IF jsonb_typeof(job_row."provider_plan_json"->'estimatedCostMicroUsd')
       IS DISTINCT FROM 'string'
     OR job_row."provider_plan_json"->>'estimatedCostMicroUsd'
          !~ '^(?:0|[1-9][0-9]{0,18})$' THEN
    RAISE EXCEPTION 'provider plan total must be a canonical nonnegative micro-USD string'
      USING ERRCODE = '23514';
  END IF;
  IF (job_row."provider_plan_json"->>'estimatedCostMicroUsd')::numeric
       > 9223372036854775807::numeric
     OR (job_row."provider_plan_json"->>'estimatedCostMicroUsd')::numeric
          <> job_row."estimated_cost_micro_usd"::numeric
     OR EXISTS (
       SELECT 1
       FROM jsonb_array_elements(
         deployment_row."deployment_json"->'capacityClasses'
       ) capacity(value)
       WHERE "foundry_jsonb_object_key_count"(capacity.value) <> 6
          OR NOT (capacity.value ?& ARRAY[
            'id', 'cpuCores', 'ramGiB', 'gpuCount', 'perGpuVramGiB', 'scratchGiB'
          ])
          OR capacity.value->>'id' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
          OR EXISTS (
            SELECT 1
            FROM (VALUES
              ('positive', capacity.value->'cpuCores', 1024::numeric),
              ('positive', capacity.value->'ramGiB', 100000::numeric),
              ('nonnegative', capacity.value->'gpuCount', 128::numeric),
              ('nonnegative', capacity.value->'perGpuVramGiB', 1000::numeric),
              ('positive', capacity.value->'scratchGiB', 1000000::numeric)
            ) numeric_leaf(requirement, value, maximum_value)
            WHERE jsonb_typeof(numeric_leaf.value) IS DISTINCT FROM 'number'
               OR CASE WHEN jsonb_typeof(numeric_leaf.value) = 'number' THEN
                    (numeric_leaf.value #>> '{}')::numeric <>
                      trunc((numeric_leaf.value #>> '{}')::numeric)
                    OR (numeric_leaf.value #>> '{}')::numeric > numeric_leaf.maximum_value
                    OR (
                      numeric_leaf.requirement = 'positive'
                      AND (numeric_leaf.value #>> '{}')::numeric <= 0
                    )
                    OR (
                      numeric_leaf.requirement = 'nonnegative'
                      AND (numeric_leaf.value #>> '{}')::numeric < 0
                    )
                  ELSE false END
          )
          OR CASE
               WHEN jsonb_typeof(capacity.value->'gpuCount') = 'number'
                AND jsonb_typeof(capacity.value->'perGpuVramGiB') = 'number'
               THEN (capacity.value->>'gpuCount')::numeric = 0
                AND (capacity.value->>'perGpuVramGiB')::numeric <> 0
               ELSE false
             END
     ) THEN
    RAISE EXCEPTION 'provider plan total and deployment capacities must match their exact runtime schemas'
      USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'stageId', job_stage.value->'id',
      'stageKind', job_stage.value->'kind',
      'dependsOn', job_stage.value->'dependsOn',
      'workerProfileId', to_jsonb(worker_profile."profile_id"),
      'workerProfileVersion', to_jsonb(worker_profile."profile_version"),
      'workerProfileSha256', to_jsonb(stage_profile."worker_profile_sha256"),
      'operationClass', to_jsonb(stage_profile."operation_class"),
      'containerImage', job_stage.value->'containerImage',
      'command', job_stage.value->'command',
      'networkAccess', job_stage.value->'networkAccess',
      'inputAssetIds', job_stage.value->'inputAssetIds',
      'outputNames', job_stage.value->'outputNames',
      'rightsPurposes', job_stage.value->'rightsPurposes',
      'checkpoint', job_stage.value->'checkpoint',
      'resumable', job_stage.value->'resumable',
      'capacityClass', plan_stage.value->'capacityClass',
      'requestedResources', jsonb_build_object(
        'cpuCores', job_stage.value->'cpuCores',
        'ramGiB', job_stage.value->'ramGiB',
        'gpuCount', job_stage.value->'gpuCount',
        'minimumGpuVramGiB', job_stage.value->'minimumGpuVramGiB',
        'scratchGiB', job_stage.value->'scratchGiB'
      ),
      'authorizedCapacity', jsonb_build_object(
        'cpuCores', capacity.value->'cpuCores',
        'ramGiB', capacity.value->'ramGiB',
        'gpuCount', capacity.value->'gpuCount',
        'perGpuVramGiB', capacity.value->'perGpuVramGiB',
        'scratchGiB', capacity.value->'scratchGiB'
      ),
      'estimatedCostMicroUsd', plan_stage.value->'estimatedCostMicroUsd',
      'maximumRuntimeSeconds', plan_stage.value->'maximumRuntimeSeconds'
    ) ORDER BY job_stage.value->>'id' COLLATE "C"
  ) INTO expected_stages
  FROM jsonb_array_elements(job_row."job_spec_json"->'stages') job_stage(value)
  JOIN LATERAL jsonb_array_elements(job_row."provider_plan_json"->'stages') plan_stage(value)
    ON plan_stage.value->>'stageId' = job_stage.value->>'id'
  JOIN "foundry_job_worker_profiles" stage_profile
    ON stage_profile."job_id" = NEW."job_id"
   AND stage_profile."project_id" = NEW."project_id"
   AND stage_profile."execution_envelope_sha256" = NEW."execution_envelope_sha256"
   AND stage_profile."stage_id" = job_stage.value->>'id'
   AND stage_profile."worker_profile_sha256" = plan_stage.value->>'workerProfileSha256'
  JOIN "foundry_trusted_worker_profiles" worker_profile
    ON worker_profile."worker_profile_sha256" = stage_profile."worker_profile_sha256"
   AND worker_profile."operation_class" = stage_profile."operation_class"
   AND worker_profile."container_image" = job_stage.value->>'containerImage'
   AND worker_profile."network_access" = job_stage.value->>'networkAccess'
   AND worker_profile."profile_json"->'command' = job_stage.value->'command'
   AND job_stage.value->'rightsPurposes' @> jsonb_build_array(
     CASE worker_profile."operation_class"
       WHEN 'read_only_inspection' THEN 'commercial_internal_use'
       WHEN 'deterministic_transformation' THEN 'commercial_internal_use'
       WHEN 'model_inference' THEN 'commercial_internal_use'
       WHEN 'model_training' THEN 'model_training'
       WHEN 'redistribution_packaging' THEN 'redistribution'
       WHEN 'public_release' THEN 'public_release'
     END
   )
  JOIN LATERAL jsonb_array_elements(deployment_row."deployment_json"->'capacityClasses') capacity(value)
    ON capacity.value->>'id' = plan_stage.value->>'capacityClass';
  IF expected_stages IS NULL OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(expected_stages) stage(value)
    CROSS JOIN LATERAL (
      VALUES
        ('positive', stage.value->'requestedResources'->'cpuCores', 1024::numeric),
        ('positive', stage.value->'requestedResources'->'ramGiB', 100000::numeric),
        ('nonnegative', stage.value->'requestedResources'->'gpuCount', 128::numeric),
        ('nonnegative', stage.value->'requestedResources'->'minimumGpuVramGiB', 1000::numeric),
        ('positive', stage.value->'requestedResources'->'scratchGiB', 1000000::numeric),
        ('positive', stage.value->'authorizedCapacity'->'cpuCores', 1024::numeric),
        ('positive', stage.value->'authorizedCapacity'->'ramGiB', 100000::numeric),
        ('nonnegative', stage.value->'authorizedCapacity'->'gpuCount', 128::numeric),
        ('nonnegative', stage.value->'authorizedCapacity'->'perGpuVramGiB', 1000::numeric),
        ('positive', stage.value->'authorizedCapacity'->'scratchGiB', 1000000::numeric),
        ('positive', stage.value->'maximumRuntimeSeconds', 31536000::numeric)
    ) AS numeric_leaf(requirement, value, maximum_value)
    WHERE jsonb_typeof(numeric_leaf.value) IS DISTINCT FROM 'number'
       OR CASE WHEN jsonb_typeof(numeric_leaf.value) = 'number' THEN
            (numeric_leaf.value #>> '{}')::numeric <>
              trunc((numeric_leaf.value #>> '{}')::numeric)
            OR (numeric_leaf.value #>> '{}')::numeric > numeric_leaf.maximum_value
            OR (
              numeric_leaf.requirement = 'positive'
              AND (numeric_leaf.value #>> '{}')::numeric <= 0
            )
            OR (
              numeric_leaf.requirement = 'nonnegative'
              AND (numeric_leaf.value #>> '{}')::numeric < 0
            )
          ELSE false END
  ) THEN
    RAISE EXCEPTION 'provider authorization numeric resources must be sign-valid safe integers'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(expected_stages) stage(value)
    WHERE "foundry_jsonb_object_key_count"(stage.value) <> 20
       OR jsonb_typeof(stage.value->'stageId') IS DISTINCT FROM 'string'
       OR stage.value->>'stageId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR jsonb_typeof(stage.value->'stageKind') IS DISTINCT FROM 'string'
       OR stage.value->>'stageKind' NOT IN (
            'inspect', 'register', 'align', 'geometry', 'appearance',
            'semantics', 'enhance', 'qa', 'package'
          )
       OR "foundry_jsonb_is_manifest_key_array"(
            stage.value->'dependsOn', 0, 100
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            stage.value->'dependsOn', 0, 100
          ) IS NOT TRUE
       OR jsonb_typeof(stage.value->'workerProfileId') IS DISTINCT FROM 'string'
       OR stage.value->>'workerProfileId' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR jsonb_typeof(stage.value->'workerProfileVersion') IS DISTINCT FROM 'string'
       OR stage.value->>'workerProfileVersion' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR jsonb_typeof(stage.value->'workerProfileSha256') IS DISTINCT FROM 'string'
       OR stage.value->>'workerProfileSha256' !~ '^sha256:[a-f0-9]{64}$'
       OR jsonb_typeof(stage.value->'operationClass') IS DISTINCT FROM 'string'
       OR stage.value->>'operationClass' NOT IN (
            'read_only_inspection', 'deterministic_transformation', 'model_inference',
            'model_training', 'redistribution_packaging', 'public_release'
          )
       OR jsonb_typeof(stage.value->'containerImage') IS DISTINCT FROM 'string'
       OR char_length(stage.value->>'containerImage') > 512
       OR stage.value->>'containerImage'
            !~ '^[a-z0-9][a-z0-9._/:@-]*@sha256:[a-f0-9]{64}$'
       OR "foundry_jsonb_is_bounded_string_array"(
            stage.value->'command', 1, 1000, 1, 2048
          ) IS NOT TRUE
       OR jsonb_typeof(stage.value->'networkAccess') IS DISTINCT FROM 'string'
       OR stage.value->>'networkAccess' NOT IN (
            'none', 'object_storage_only', 'restricted'
          )
       OR "foundry_jsonb_is_manifest_key_array"(
            stage.value->'inputAssetIds', 0, 100000
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            stage.value->'inputAssetIds', 0, 100000
          ) IS NOT TRUE
       OR "foundry_jsonb_is_manifest_key_array"(
            stage.value->'outputNames', 1, 1000
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            stage.value->'outputNames', 1, 1000
          ) IS NOT TRUE
       OR "foundry_jsonb_is_bounded_string_array"(
            stage.value->'rightsPurposes', 1, 4, 1, 32
          ) IS NOT TRUE
       OR "foundry_jsonb_is_unique_string_array"(
            stage.value->'rightsPurposes', 1, 4
          ) IS NOT TRUE
       OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(stage.value->'rightsPurposes') purpose(value)
            WHERE purpose.value NOT IN (
              'commercial_internal_use', 'model_training',
              'redistribution', 'public_release'
            )
          )
       OR jsonb_typeof(stage.value->'checkpoint') IS DISTINCT FROM 'string'
       OR stage.value->>'checkpoint' NOT IN ('none', 'stage_boundary', 'periodic')
       OR jsonb_typeof(stage.value->'resumable') IS DISTINCT FROM 'boolean'
       OR CASE
            WHEN jsonb_typeof(stage.value->'resumable') = 'boolean'
            THEN (stage.value->>'resumable')::boolean
              AND stage.value->>'checkpoint' = 'none'
            ELSE false
          END
       OR jsonb_typeof(stage.value->'capacityClass') IS DISTINCT FROM 'string'
       OR stage.value->>'capacityClass' !~ '^[a-z0-9][a-z0-9._-]{0,119}$'
       OR jsonb_typeof(stage.value->'requestedResources') IS DISTINCT FROM 'object'
       OR "foundry_jsonb_object_key_count"(stage.value->'requestedResources') <> 5
       OR jsonb_typeof(stage.value->'authorizedCapacity') IS DISTINCT FROM 'object'
       OR "foundry_jsonb_object_key_count"(stage.value->'authorizedCapacity') <> 5
       OR (stage.value->'requestedResources'->>'cpuCores')::numeric >
            (stage.value->'authorizedCapacity'->>'cpuCores')::numeric
       OR (stage.value->'requestedResources'->>'ramGiB')::numeric >
            (stage.value->'authorizedCapacity'->>'ramGiB')::numeric
       OR (stage.value->'requestedResources'->>'gpuCount')::numeric >
            (stage.value->'authorizedCapacity'->>'gpuCount')::numeric
       OR (
            (stage.value->'requestedResources'->>'gpuCount')::numeric = 0
            AND (stage.value->'requestedResources'->>'minimumGpuVramGiB')::numeric <> 0
          )
       OR (
            (stage.value->'authorizedCapacity'->>'gpuCount')::numeric = 0
            AND (stage.value->'authorizedCapacity'->>'perGpuVramGiB')::numeric <> 0
          )
       OR (stage.value->'requestedResources'->>'minimumGpuVramGiB')::numeric >
            (stage.value->'authorizedCapacity'->>'perGpuVramGiB')::numeric
       OR (stage.value->'requestedResources'->>'scratchGiB')::numeric >
            (stage.value->'authorizedCapacity'->>'scratchGiB')::numeric
       OR jsonb_typeof(stage.value->'estimatedCostMicroUsd') IS DISTINCT FROM 'string'
       OR stage.value->>'estimatedCostMicroUsd' !~ '^(?:0|[1-9][0-9]{0,18})$'
       OR CASE
            WHEN stage.value->>'estimatedCostMicroUsd' ~ '^(?:0|[1-9][0-9]{0,18})$'
            THEN (stage.value->>'estimatedCostMicroUsd')::numeric > 9223372036854775807::numeric
            ELSE false
          END
       OR (stage.value->>'maximumRuntimeSeconds')::numeric >
            execution_row."max_wall_clock_seconds"::numeric
  ) THEN
    RAISE EXCEPTION 'provider authorization stage structure is outside the closed runtime schema'
      USING ERRCODE = '23514';
  END IF;
  IF (
    SELECT COALESCE(sum((stage.value->>'estimatedCostMicroUsd')::numeric), 0)
    FROM jsonb_array_elements(expected_stages) stage(value)
  ) IS DISTINCT FROM job_row."estimated_cost_micro_usd"::numeric THEN
    RAISE EXCEPTION 'provider authorization stage costs must sum to the immutable job estimate'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(expected_stages) stage(value)
    CROSS JOIN LATERAL jsonb_array_elements_text(stage.value->'dependsOn') dependency(value)
    WHERE dependency.value = stage.value->>'stageId'
       OR NOT EXISTS (
         SELECT 1
         FROM jsonb_array_elements(expected_stages) declared_stage(value)
         WHERE declared_stage.value->>'stageId' = dependency.value
       )
  ) OR EXISTS (
    WITH RECURSIVE edges(stage_id, dependency_id) AS (
      SELECT stage.value->>'stageId', dependency.value
      FROM jsonb_array_elements(expected_stages) stage(value)
      CROSS JOIN LATERAL jsonb_array_elements_text(stage.value->'dependsOn') dependency(value)
    ), dependency_walk(origin_id, current_id) AS (
      SELECT edge.stage_id, edge.dependency_id
      FROM edges edge
      UNION
      SELECT dependency_walk.origin_id, edge.dependency_id
      FROM dependency_walk
      JOIN edges edge ON edge.stage_id = dependency_walk.current_id
    )
    SELECT 1 FROM dependency_walk WHERE origin_id = current_id
  ) THEN
    RAISE EXCEPTION 'provider authorization stage graph must be declared, self-free, and acyclic'
      USING ERRCODE = '23514';
  END IF;
  critical_path_seconds := "foundry_stage_graph_critical_path_seconds"(expected_stages);
  IF critical_path_seconds IS NULL
     OR critical_path_seconds + execution_row."orchestration_overhead_seconds"::numeric
          > execution_row."max_wall_clock_seconds"::numeric THEN
    RAISE EXCEPTION 'provider authorization critical path exceeds the immutable wall-clock policy'
      USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_agg(stage.value->'stageId' ORDER BY stage.value->>'stageId' COLLATE "C"),
         jsonb_agg(
           jsonb_build_object(
             'stageId', stage.value->'stageId',
             'purposes', stage.value->'rightsPurposes'
           ) ORDER BY stage.value->>'stageId' COLLATE "C"
         )
  INTO expected_stage_ids, expected_rights_stage_purposes
  FROM jsonb_array_elements(expected_stages) stage(value);
  IF expected_stages IS NULL
     OR jsonb_array_length(expected_stages) <> jsonb_array_length(job_row."job_spec_json"->'stages')
     OR NEW."stage_ids" IS DISTINCT FROM expected_stage_ids
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(expected_stages) stage(value)
       WHERE NOT (profile_row."profile_json"->'allowedContainerImages' @>
                    jsonb_build_array(stage.value->'containerImage'))
          OR NOT (profile_row."profile_json"->'allowedNetworkAccess' @>
                    jsonb_build_array(stage.value->'networkAccess'))
           OR NOT (profile_row."profile_json"->'allowedCapacityClasses' @>
                     jsonb_build_array(stage.value->'capacityClass'))
     )
     OR jsonb_typeof(job_row."job_spec_json"->'sourceMountMode')
          IS DISTINCT FROM 'string'
     OR job_row."job_spec_json"->>'sourceMountMode' IS DISTINCT FROM 'read_only'
     OR jsonb_typeof(job_row."job_spec_json"->'outputPrefix')
          IS DISTINCT FROM 'string'
     OR "foundry_is_safe_relative_path"(
          job_row."job_spec_json"->>'outputPrefix'
        ) IS NOT TRUE
     OR NOT (job_row."job_spec_json" ? 'objectStorageProfile')
     OR (
       execution_row."provider_kind" NOT IN ('local_cpu', 'local_cuda')
       AND (
         job_row."job_spec_json"->'objectStorageProfile'
           IS NOT DISTINCT FROM 'null'::jsonb
         OR jsonb_typeof(job_row."job_spec_json"->'objectStorageProfile')
           IS DISTINCT FROM 'string'
       )
     )
     OR (
       job_row."job_spec_json"->'objectStorageProfile'
         IS DISTINCT FROM 'null'::jsonb
       AND (
         jsonb_typeof(job_row."job_spec_json"->'objectStorageProfile')
           IS DISTINCT FROM 'string'
         OR NOT (profile_row."profile_json"->'allowedObjectStorageProfiles' @>
                  jsonb_build_array(job_row."job_spec_json"->'objectStorageProfile'))
       )
     ) THEN
    RAISE EXCEPTION 'prepared provider request stages do not equal the trusted job, plan, worker, capacity, and profile bindings'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."command_kind" = 'provider_checkpoint' AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(expected_stages) stage(value)
    WHERE stage.value->>'checkpoint' <> 'none'
  ) THEN
    RAISE EXCEPTION 'provider checkpoint is not authorized by any exact job stage'
      USING ERRCODE = '23514';
  END IF;

  CASE NEW."command_kind"
    WHEN 'provider_submit' THEN
      expected_action := jsonb_build_object(
        'kind', 'provider_submit', 'providerCommandRef', NULL
      );
    WHEN 'provider_reconcile' THEN
      SELECT s.* INTO originating_submit
      FROM "foundry_provider_commands" s
      WHERE s."id"::text = NEW."provider_request_json"->'action'->>'submitCommandId'
        AND s."execution_id" = NEW."execution_id"
        AND s."attempt_id" = NEW."attempt_id"
        AND s."fencing_token" = NEW."fencing_token"
        AND s."command_kind" = 'provider_submit'
        AND s."command_sequence" < NEW."command_sequence"
        AND s."provider_request_sha256" =
          NEW."provider_request_json"->'action'->>'submitProviderRequestAuthorizationSha256'
        AND s."provider_idempotency_key" = NEW."provider_idempotency_key";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider reconcile authorization lost its exact original submit lineage'
          USING ERRCODE = '23514';
      END IF;
      expected_action := jsonb_build_object(
        'kind', 'provider_reconcile',
        'providerCommandRef', attempt_provider_execution_ref,
        'submitCommandId', originating_submit."id"::text,
        'submitProviderRequestAuthorizationSha256', originating_submit."provider_request_sha256"
      );
    WHEN 'provider_poll' THEN
      expected_action := jsonb_build_object(
        'kind', 'provider_poll', 'providerCommandRef', attempt_provider_execution_ref
      );
    WHEN 'provider_checkpoint' THEN
      expected_action := jsonb_build_object(
        'kind', 'provider_checkpoint', 'providerCommandRef', attempt_provider_execution_ref
      );
    WHEN 'provider_stop' THEN
      expected_action := jsonb_build_object(
        'kind', 'provider_stop',
        'providerCommandRef', attempt_provider_execution_ref,
        'stopIntentId', NEW."stop_intent_id"::text
      );
  END CASE;

  expected_authorization := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.provider-request-authorization.v0',
    'authority', 'none',
    'commandKind', NEW."command_kind",
    'commandId', NEW."provider_command_id"::text,
    'commandSequence', NEW."command_sequence",
    'preparedAt', to_char(
      NEW."prepared_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
    ),
    'execution', jsonb_build_object(
      'executionId', NEW."execution_id"::text,
      'attemptId', NEW."attempt_id"::text,
      'attemptOrdinal', NEW."attempt_ordinal",
      'fencingToken', NEW."fencing_token"::text,
      'executionSubjectSha256', NEW."execution_subject_sha256",
      'subjectId', execution_row."execution_subject_json"->'subjectId',
      'projectId', NEW."project_id",
      'jobId', NEW."job_id"
    ),
    'requestIdentity', jsonb_build_object(
      'providerIdempotencyKey', NEW."provider_idempotency_key",
      'clientRequestId', NEW."provider_client_request_id",
      'resourceMarker', jsonb_build_object(
        'executionSubjectSha256', NEW."execution_subject_sha256",
        'providerIdempotencyKey', NEW."provider_idempotency_key"
      )
    ),
    'evidence', jsonb_build_object(
      'jobSpecSha256', execution_row."job_spec_sha256",
      'reviewedIngestManifestSha256', execution_row."reviewed_ingest_manifest_sha256",
      'intakeAdmissionResultSha256', execution_row."intake_admission_result_sha256",
      'intakeStagingIndexSha256', execution_row."intake_staging_index_sha256",
      'executionEnvelopeSha256', execution_row."execution_envelope_sha256",
      'executionPolicySha256', execution_row."execution_policy_sha256",
      'providerPlanSha256', execution_row."provider_plan_sha256",
      'providerDeploymentSha256', execution_row."provider_deployment_sha256",
      'workerProfileSha256s', (
        SELECT jsonb_agg(
          to_jsonb(worker_profile.worker_profile_sha256)
          ORDER BY worker_profile.worker_profile_sha256 COLLATE "C"
        )
        FROM (
          SELECT DISTINCT jwp."worker_profile_sha256"
          FROM "foundry_job_worker_profiles" jwp
          WHERE jwp."job_id" = NEW."job_id"
            AND jwp."project_id" = NEW."project_id"
            AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
            AND jwp."provider_plan_sha256" = execution_row."provider_plan_sha256"
            AND jwp."trusted_worker_profile_set_sha256" =
                  execution_row."trusted_worker_profile_set_sha256"
        ) worker_profile
      ),
      'executionConfirmationSha256', execution_row."confirmation_sha256",
      'computeApprovalSha256', execution_row."compute_approval_sha256"
    ),
    'provider', jsonb_build_object(
      'providerKind', NEW."provider_kind",
      'providerAdapterId', NEW."provider_adapter_id",
      'providerAdapterVersion', NEW."provider_adapter_version",
      'providerAdapterArtifactSha256', NEW."provider_adapter_artifact_sha256",
      'providerAdapterConfigurationSha256', NEW."provider_adapter_configuration_sha256",
      'providerDeploymentId', deployment_row."deployment_id",
      'providerDeploymentSha256', NEW."provider_deployment_sha256",
      'accountProjectAlias', deployment_row."account_project_alias",
      'region', deployment_row."region",
      'dataResidency', deployment_row."data_residency",
      'providerRequestProfileId', NEW."provider_request_profile_id",
      'providerRequestProfileVersion', NEW."provider_request_profile_version",
      'providerRequestProfileSha256', NEW."provider_request_profile_sha256",
      'target', profile_row."profile_json"->'target'
    ),
    'rights', jsonb_build_object(
      'rightsApprovalSha256', execution_row."rights_approval_sha256",
      'rightsPolicyEvidenceSha256', execution_row."rights_policy_evidence_sha256",
      'rightsPolicyDefinitionSha256', execution_row."rights_policy_definition_sha256",
      'policyVersion', execution_row."rights_policy_version",
      'policyGeneration', execution_row."rights_policy_generation",
      'decision', 'allowed',
      'stagePurposes', expected_rights_stage_purposes
    ),
    'storage', jsonb_build_object(
      'sourceMountMode', job_row."job_spec_json"->'sourceMountMode',
      'objectStorageProfile', job_row."job_spec_json"->'objectStorageProfile',
      'outputPrefix', job_row."job_spec_json"->'outputPrefix'
    ),
    'runtime', jsonb_build_object(
      'maximumApiCallSeconds', NEW."maximum_api_call_seconds",
      'maximumWallClockSeconds', execution_row."max_wall_clock_seconds",
      'workerSelfDeadlineSeconds', execution_row."worker_self_deadline_seconds",
      'providerMaximumExecutionTtlSeconds', execution_row."provider_maximum_execution_ttl_seconds",
      'dispatchDeadline', to_char(
        execution_row."dispatch_deadline" AT TIME ZONE 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'observationIntervalSeconds', policy_row."observation_interval_seconds",
      'checkpointIntervalSeconds', policy_row."checkpoint_interval_seconds",
      'cancelGracePeriodSeconds', execution_row."cancel_grace_seconds",
      'terminationGracePeriodSeconds', execution_row."termination_grace_seconds",
      'terminationConfirmationTimeoutSeconds', execution_row."termination_confirmation_timeout_seconds",
      'budgetPolicy', jsonb_build_object(
        'currency', 'USD',
        'costWarningMicroUsd', execution_row."cost_warning_micro_usd"::text,
        'costHardStopMicroUsd', execution_row."cost_hard_stop_micro_usd"::text,
        'terminationReserveMicroUsd', execution_row."termination_reserve_micro_usd"::text,
        'absoluteCostCapMicroUsd', execution_row."absolute_cost_cap_micro_usd"::text,
        'costObservationMaximumAgeSeconds', policy_row."cost_observation_maximum_age_seconds"
      ),
      'checkpointContract', execution_row."execution_subject_json"->'checkpointContract'
    ),
    'stages', expected_stages,
    'action', expected_action
  );
  IF NEW."provider_request_json" IS DISTINCT FROM expected_authorization THEN
    RAISE EXCEPTION 'provider request must equal the exact closed authorization compiled from trusted evidence'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."provider_request_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
    'omnitwin.foundry.provider-request-authorization.v0', expected_authorization
  ) THEN
    RAISE EXCEPTION 'provider request digest must bind the exact database-compiled authorization'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_attempt_projection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  exec_state varchar(40);
  exec_ordinal integer;
  exec_fence bigint;
  exec_total bigint;
  exec_hard_stop bigint;
  exec_reserve bigint;
  exec_absolute bigint;
  exec_deadline timestamptz;
  rights_policy_version varchar(120);
  lease_ttl_seconds integer;
  lease_now timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT e."rights_policy_version" INTO rights_policy_version
    FROM "foundry_executions" e
    WHERE e."id" = NEW."execution_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attempt execution scope is absent' USING ERRCODE = '23503';
    END IF;
    PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
    PERFORM "foundry_lock_execution_control_scopes"(
      NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
      NEW."project_id", NEW."execution_id", NEW."id"
    );
    SELECT e."state", e."last_attempt_ordinal", e."fencing_token", e."total_cost_micro_usd",
           e."cost_hard_stop_micro_usd", e."termination_reserve_micro_usd",
           e."absolute_cost_cap_micro_usd", e."dispatch_deadline", e."rights_policy_version"
    INTO exec_state, exec_ordinal, exec_fence, exec_total, exec_hard_stop,
         exec_reserve, exec_absolute, exec_deadline, rights_policy_version
    FROM "foundry_executions" e
    WHERE e."id" = NEW."execution_id"
      AND e."project_id" = NEW."project_id"
      AND e."job_id" = NEW."job_id"
      AND e."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND e."provider_kind" = NEW."provider_kind"
      AND e."provider_adapter_id" = NEW."provider_adapter_id"
      AND e."provider_adapter_version" = NEW."provider_adapter_version"
      AND e."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND e."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attempt execution scope is absent' USING ERRCODE = '23503';
    END IF;
    IF exec_state <> 'admitted_awaiting_executor' OR exec_ordinal <> 0 OR exec_fence <> 0 THEN
      RAISE EXCEPTION 'immutable execution policy permits exactly one attempt' USING ERRCODE = '23514';
    END IF;
    IF clock_timestamp() >= exec_deadline
       OR exec_total >= exec_hard_stop
       OR exec_total + exec_reserve > exec_absolute
       OR NOT "foundry_execution_authority_is_current"(NEW."execution_id", clock_timestamp()) THEN
      RAISE EXCEPTION 'execution deadline or cost hard stop blocks a new attempt' USING ERRCODE = '55000';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "foundry_kill_switches" k
      WHERE k."state" = 'active' AND (
        k."scope" = 'global'
        OR (k."scope" = 'provider' AND k."provider_kind" = NEW."provider_kind"
          AND k."provider_adapter_id" = NEW."provider_adapter_id"
          AND k."provider_adapter_version" = NEW."provider_adapter_version")
        OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
        OR (k."scope" = 'execution' AND k."execution_id" = NEW."execution_id")
      )
    ) THEN
      RAISE EXCEPTION 'new attempt is blocked by an active kill switch' USING ERRCODE = '55000';
    END IF;
    IF NEW."attempt_ordinal" <> exec_ordinal + 1
       OR NEW."fencing_token" <> exec_fence + 1
       OR NEW."state" <> 'authorized'
       OR NEW."observed_cost_micro_usd" <> 0
       OR NEW."cancel_requested"
       OR NEW."revision" <> 0
       OR NEW."provider_execution_ref" IS NOT NULL
       OR NEW."provider_attempt_ref" IS NOT NULL
       OR NEW."lease_owner" IS NOT NULL
       OR NEW."lease_expires_at" IS NOT NULL
       OR NEW."submitted_at" IS NOT NULL
       OR NEW."started_at" IS NOT NULL
       OR NEW."finished_at" IS NOT NULL
       OR NEW."updated_at" <> NEW."created_at" THEN
      RAISE EXCEPTION 'attempt must begin as a fresh authorized fenced projection' USING ERRCODE = '23514';
    END IF;
    UPDATE "foundry_executions"
    SET "state" = 'authorized',
        "last_attempt_ordinal" = NEW."attempt_ordinal",
        "fencing_token" = NEW."fencing_token",
        "cancel_requested" = false,
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."execution_id";
    RETURN NEW;
  END IF;

  IF ROW(
    NEW."execution_id", NEW."project_id", NEW."job_id", NEW."execution_envelope_sha256",
    NEW."execution_subject_sha256",
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."attempt_ordinal", NEW."fencing_token", NEW."created_by_user_id",
    NEW."idempotency_key", NEW."request_digest", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."execution_id", OLD."project_id", OLD."job_id", OLD."execution_envelope_sha256",
    OLD."execution_subject_sha256",
    OLD."provider_kind", OLD."provider_adapter_id", OLD."provider_adapter_version",
    OLD."provider_adapter_artifact_sha256", OLD."provider_deployment_sha256",
    OLD."attempt_ordinal", OLD."fencing_token", OLD."created_by_user_id",
    OLD."idempotency_key", OLD."request_digest", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'attempt identity and fence are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'attempt update requires the next revision and a later timestamp' USING ERRCODE = '40001';
  END IF;
  IF pg_trigger_depth() < 2 AND ROW(
       NEW."state", NEW."provider_execution_ref", NEW."provider_attempt_ref",
       NEW."observed_cost_micro_usd", NEW."cancel_requested",
       NEW."submitted_at", NEW."started_at", NEW."finished_at",
       NEW."wall_clock_deadline", NEW."cancel_deadline", NEW."termination_deadline",
       NEW."worker_self_deadline", NEW."termination_confirmation_deadline",
       NEW."provider_ttl_deadline"
     ) IS DISTINCT FROM ROW(
       OLD."state", OLD."provider_execution_ref", OLD."provider_attempt_ref",
       OLD."observed_cost_micro_usd", OLD."cancel_requested",
       OLD."submitted_at", OLD."started_at", OLD."finished_at",
       OLD."wall_clock_deadline", OLD."cancel_deadline", OLD."termination_deadline",
       OLD."worker_self_deadline", OLD."termination_confirmation_deadline",
       OLD."provider_ttl_deadline"
     ) THEN
    RAISE EXCEPTION 'attempt state, cost, provider, and terminal projections require a controlled causal trigger'
      USING ERRCODE = '55000';
  END IF;
  IF ROW(NEW."lease_owner", NEW."lease_expires_at") IS DISTINCT FROM
     ROW(OLD."lease_owner", OLD."lease_expires_at") THEN
    lease_now := clock_timestamp();
    SELECT p."lease_ttl_seconds" INTO lease_ttl_seconds
    FROM "foundry_executions" e
    JOIN "foundry_execution_policies" p
      ON p."execution_policy_sha256" = e."execution_policy_sha256"
    WHERE e."id" = NEW."execution_id"
      AND e."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF e;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attempt lease lost its execution fence' USING ERRCODE = '40001';
    END IF;
    IF left(NEW."state", 9) = 'terminal_'
       OR NEW."updated_at" < statement_timestamp() - interval '5 seconds'
       OR NEW."updated_at" > lease_now + interval '1 second'
       OR (
         OLD."lease_owner" IS NOT NULL
         AND OLD."lease_expires_at" > lease_now
         AND NEW."lease_owner" IS DISTINCT FROM OLD."lease_owner"
       )
       OR (
         NEW."lease_owner" IS NOT NULL AND (
           NEW."lease_expires_at" <= lease_now
           OR NEW."lease_expires_at" > lease_now + make_interval(secs => lease_ttl_seconds)
         )
       ) THEN
      RAISE EXCEPTION 'attempt lease acquisition or heartbeat violates owner, fence, clock, or TTL'
        USING ERRCODE = '40001';
    END IF;
    NEW."updated_at" := lease_now;
  END IF;
  IF NEW."observed_cost_micro_usd" < OLD."observed_cost_micro_usd" THEN
    RAISE EXCEPTION 'attempt cost cannot decrease' USING ERRCODE = '23514';
  END IF;
  IF NEW."observed_cost_micro_usd" <> OLD."observed_cost_micro_usd" AND pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'attempt cost changes require an append-only cost observation' USING ERRCODE = '23514';
  END IF;
  IF OLD."provider_execution_ref" IS NOT NULL
     AND NEW."provider_execution_ref" IS DISTINCT FROM OLD."provider_execution_ref" THEN
    RAISE EXCEPTION 'provider execution reference cannot be replaced' USING ERRCODE = '23514';
  END IF;
  IF OLD."provider_attempt_ref" IS NOT NULL
     AND NEW."provider_attempt_ref" IS DISTINCT FROM OLD."provider_attempt_ref" THEN
    RAISE EXCEPTION 'provider attempt reference cannot be replaced' USING ERRCODE = '23514';
  END IF;
  IF OLD."submitted_at" IS NOT NULL AND ROW(
       NEW."submitted_at", NEW."wall_clock_deadline", NEW."cancel_deadline",
       NEW."termination_deadline", NEW."worker_self_deadline",
       NEW."termination_confirmation_deadline", NEW."provider_ttl_deadline"
     ) IS DISTINCT FROM ROW(
       OLD."submitted_at", OLD."wall_clock_deadline", OLD."cancel_deadline",
       OLD."termination_deadline", OLD."worker_self_deadline",
       OLD."termination_confirmation_deadline", OLD."provider_ttl_deadline"
     ) THEN
    RAISE EXCEPTION 'provider acceptance time and derived runtime deadlines are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."cancel_requested" AND NOT NEW."cancel_requested" THEN
    RAISE EXCEPTION 'attempt cancel request cannot be cleared' USING ERRCODE = '23514';
  END IF;
  IF left(NEW."state", 9) <> 'terminal_' THEN
    SELECT e."fencing_token" INTO exec_fence
    FROM "foundry_executions" e WHERE e."id" = NEW."execution_id" FOR UPDATE;
    IF exec_fence <> NEW."fencing_token" THEN
      RAISE EXCEPTION 'stale attempt fence cannot mutate a nonterminal attempt' USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" <> NEW."state" AND NOT (
    (OLD."state" = 'authorized' AND NEW."state" IN ('submit_pending', 'stop_pending', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded'))
    OR (OLD."state" = 'submit_pending' AND NEW."state" IN ('provider_unknown', 'queued', 'running', 'stop_pending', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded'))
    OR (OLD."state" = 'provider_unknown' AND NEW."state" IN ('queued', 'running', 'validating', 'stop_pending', 'terminating', 'termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'queued' AND NEW."state" IN ('running', 'checkpointing', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'running' AND NEW."state" IN ('checkpointing', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'checkpointing' AND NEW."state" IN ('running', 'stop_pending', 'validating', 'terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'stop_pending' AND NEW."state" IN ('terminating', 'termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'terminating' AND NEW."state" IN ('termination_unconfirmed', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'termination_unconfirmed' AND NEW."state" IN ('terminating', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_provider_lost'))
    OR (OLD."state" = 'validating' AND NEW."state" IN ('terminal_succeeded', 'terminal_failed', 'terminal_cancelled', 'terminal_killed', 'terminal_budget_exceeded', 'terminal_validation_failed', 'terminal_provider_lost'))
  ) THEN
    RAISE EXCEPTION 'illegal attempt state transition: % -> %', OLD."state", NEW."state" USING ERRCODE = '23514';
  END IF;

  IF NEW."state" IS DISTINCT FROM OLD."state"
     OR NEW."cancel_requested" IS DISTINCT FROM OLD."cancel_requested" THEN
    UPDATE "foundry_executions"
    SET "state" = NEW."state",
        "cancel_requested" = NEW."cancel_requested",
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."execution_id" AND "fencing_token" = NEW."fencing_token";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'attempt projection lost its execution fence' USING ERRCODE = '40001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_kill_switch_projection"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'inactive' OR NEW."revision" <> 0
       OR NEW."last_changed_actor_kind" <> 'operator'
       OR NEW."last_changed_by_user_id" <> NEW."created_by_user_id"
       OR NEW."created_at" <> NEW."updated_at" THEN
      RAISE EXCEPTION 'kill-switch projection must begin inactive at revision zero' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF pg_trigger_depth() < 2 THEN
    RAISE EXCEPTION 'kill-switch projection changes require an append-only event' USING ERRCODE = '23514';
  END IF;
  IF ROW(
    NEW."scope", NEW."target_key", NEW."project_id", NEW."execution_id", NEW."attempt_id",
    NEW."job_id", NEW."execution_envelope_sha256", NEW."provider_kind",
    NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256", NEW."attempt_ordinal",
    NEW."fencing_token", NEW."created_by_user_id", NEW."idempotency_key",
    NEW."request_digest", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."scope", OLD."target_key", OLD."project_id", OLD."execution_id", OLD."attempt_id",
    OLD."job_id", OLD."execution_envelope_sha256", OLD."provider_kind",
    OLD."provider_adapter_id", OLD."provider_adapter_version",
    OLD."provider_adapter_artifact_sha256", OLD."provider_deployment_sha256", OLD."attempt_ordinal",
    OLD."fencing_token", OLD."created_by_user_id", OLD."idempotency_key",
    OLD."request_digest", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'kill-switch scope is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" < OLD."updated_at"
     OR NEW."state" = OLD."state" THEN
    RAISE EXCEPTION 'kill-switch update requires a toggled state and next revision' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "apply_foundry_kill_switch_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_state varchar(20);
  current_revision bigint;
  current_created_at timestamptz;
  kill_project_id varchar(120);
  kill_execution_id uuid;
  kill_attempt_id uuid;
  kill_provider_kind varchar(40);
  kill_provider_adapter_id varchar(120);
  kill_provider_adapter_version varchar(120);
  expected_sequence bigint;
BEGIN
  NEW."recorded_at" := clock_timestamp();
  PERFORM "foundry_lock_execution_control_scopes"(
    NULL, NULL, NULL, NULL, NULL, NULL
  );
  SELECT k."state", k."revision", k."created_at", k."project_id",
         k."execution_id", k."attempt_id", k."provider_kind",
         k."provider_adapter_id", k."provider_adapter_version"
  INTO current_state, current_revision, current_created_at, kill_project_id,
       kill_execution_id, kill_attempt_id, kill_provider_kind,
       kill_provider_adapter_id, kill_provider_adapter_version
  FROM "foundry_kill_switches" k
  WHERE k."id" = NEW."kill_switch_id"
    AND k."scope" = NEW."scope"
    AND k."target_key" = NEW."target_key"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kill-switch event scope is absent' USING ERRCODE = '23503';
  END IF;
  PERFORM "foundry_lock_execution_control_scopes"(
    kill_provider_kind, kill_provider_adapter_id, kill_provider_adapter_version,
    kill_project_id, kill_execution_id, kill_attempt_id
  );
  SELECT COALESCE(MAX(e."sequence"), 0) + 1 INTO expected_sequence
  FROM "foundry_kill_switch_events" e WHERE e."kill_switch_id" = NEW."kill_switch_id";
  IF NEW."sequence" <> expected_sequence
     OR NEW."expected_revision" <> current_revision
     OR NEW."resulting_revision" <> current_revision + 1
     OR NEW."recorded_at" < current_created_at THEN
    RAISE EXCEPTION 'kill-switch event sequence or revision is not contiguous' USING ERRCODE = '40001';
  END IF;
  IF (NEW."action" = 'activate' AND current_state <> 'inactive')
     OR (NEW."action" = 'release' AND current_state <> 'active') THEN
    RAISE EXCEPTION 'kill-switch action does not toggle current state' USING ERRCODE = '23514';
  END IF;
  UPDATE "foundry_kill_switches"
  SET "state" = CASE NEW."action" WHEN 'activate' THEN 'active' ELSE 'inactive' END,
      "reason" = NEW."reason",
      "last_changed_actor_kind" = NEW."actor_kind",
      "last_changed_actor_key" = NEW."actor_key",
      "last_changed_by_user_id" = NEW."actor_user_id",
      "revision" = NEW."resulting_revision",
      "updated_at" = NEW."recorded_at"
  WHERE "id" = NEW."kill_switch_id";
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_execution_event_sequence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  admitted timestamptz;
  current_revision bigint;
  invocation_submit_ok boolean;
  invocation_followup_ok boolean;
  invocation_at timestamptz;
  rights_policy_version varchar(120);
  expected_sequence bigint;
  expected_event_revision bigint;
  invocation_command_ok boolean;
  runtime_deadline timestamptz;
  command_event_ok boolean;
  command_completed_at timestamptz;
  command_actor_kind varchar(30);
  command_actor_key varchar(160);
  projection_delta bigint;
  matching_invocation_exists boolean;
  transition_command_ok boolean;
  transition_command_revision bigint;
  transition_recorded_at timestamptz;
  transition_actor_kind varchar(30);
  transition_actor_key varchar(160);
  transition_actor_user_id uuid;
  expected_transition_payload jsonb;
  stop_intent_event_ok boolean;
  stop_intent_recorded_at timestamptz;
  stop_intent_actor_kind varchar(30);
  stop_intent_actor_key varchar(160);
  stop_intent_actor_user_id uuid;
  expected_stop_intent_payload jsonb;
  cost_event_ok boolean;
  cost_recorded_at timestamptz;
  cost_actor_key varchar(160);
  expected_cost_payload jsonb;
BEGIN
  SELECT e."rights_policy_version" INTO rights_policy_version
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution event scope is absent' USING ERRCODE = '23503';
  END IF;
  PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  IF NEW."attempt_id" IS NOT NULL THEN
    PERFORM 1
    FROM "foundry_attempts" event_attempt
    WHERE event_attempt."id" = NEW."attempt_id"
      AND event_attempt."execution_id" = NEW."execution_id"
      AND event_attempt."project_id" = NEW."project_id"
      AND event_attempt."job_id" = NEW."job_id"
      AND event_attempt."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND event_attempt."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND event_attempt."provider_kind" = NEW."provider_kind"
      AND event_attempt."provider_adapter_id" = NEW."provider_adapter_id"
      AND event_attempt."provider_adapter_version" = NEW."provider_adapter_version"
      AND event_attempt."provider_adapter_artifact_sha256" =
            NEW."provider_adapter_artifact_sha256"
      AND event_attempt."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND event_attempt."attempt_ordinal" = NEW."attempt_ordinal"
      AND event_attempt."fencing_token" = NEW."fencing_token"
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'execution event attempt scope is absent' USING ERRCODE = '23503';
    END IF;
  END IF;
  SELECT e."admitted_at", e."revision", e."rights_policy_version"
  INTO admitted, current_revision, rights_policy_version
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id"
    AND e."project_id" = NEW."project_id"
    AND e."job_id" = NEW."job_id"
    AND e."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND e."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND e."provider_kind" = NEW."provider_kind"
    AND e."provider_adapter_id" = NEW."provider_adapter_id"
    AND e."provider_adapter_version" = NEW."provider_adapter_version"
    AND e."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND e."provider_deployment_sha256" = NEW."provider_deployment_sha256"
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execution event scope is absent' USING ERRCODE = '23503';
  END IF;
  IF NEW."event_kind" = 'provider_command_transitioned' THEN
    IF pg_trigger_depth() < 2 THEN
      RAISE EXCEPTION 'provider command transition events are system-appended by the command trigger'
        USING ERRCODE = '23514';
    END IF;
    SELECT true,
           c."revision",
           CASE NEW."payload"->>'transitionKind'
             WHEN 'enqueued' THEN c."created_at"
             WHEN 'claimed' THEN c."claimed_at"
             WHEN 'claim_released' THEN c."updated_at"
             WHEN 'cancelled' THEN c."completed_at"
           END,
           CASE NEW."payload"->>'transitionKind'
             WHEN 'enqueued' THEN c."created_by_actor_kind"
             WHEN 'claimed' THEN 'service'
             ELSE 'system'
           END,
           CASE NEW."payload"->>'transitionKind'
             WHEN 'enqueued' THEN c."created_by_actor_key"
             WHEN 'claimed' THEN c."claimed_by"
             WHEN 'claim_released' THEN 'system:provider-command-lease-recovery'
             ELSE 'system:provider-command-cancellation'
           END,
           CASE NEW."payload"->>'transitionKind'
             WHEN 'enqueued' THEN c."created_by_user_id"
             ELSE NULL
           END,
           jsonb_build_object(
             'schemaVersion', 'omnitwin.foundry.provider-command-transition.v0',
             'transitionKind', NEW."payload"->>'transitionKind',
             'commandId', c."id"::text,
             'commandRevision', c."revision",
             'commandState', c."state",
             'claimToken', to_jsonb(NEW."claim_token"::text),
             'cancelledByStopIntentId', to_jsonb(c."cancelled_by_stop_intent_id"::text),
             'cancelledByProviderCommandId',
               to_jsonb(c."cancelled_by_provider_command_id"::text)
           )
    INTO transition_command_ok, transition_command_revision,
         transition_recorded_at, transition_actor_kind, transition_actor_key,
         transition_actor_user_id, expected_transition_payload
    FROM "foundry_provider_commands" c
    WHERE c."id" = NEW."provider_command_id"
      AND c."execution_id" = NEW."execution_id"
      AND c."project_id" = NEW."project_id"
      AND c."job_id" = NEW."job_id"
      AND c."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND c."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND c."provider_kind" = NEW."provider_kind"
      AND c."provider_adapter_id" = NEW."provider_adapter_id"
      AND c."provider_adapter_version" = NEW."provider_adapter_version"
      AND c."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND c."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND c."attempt_id" = NEW."attempt_id"
      AND c."attempt_ordinal" = NEW."attempt_ordinal"
      AND c."fencing_token" = NEW."fencing_token"
      AND c."command_kind" = NEW."provider_command_kind"
      AND c."payload_sha256" = NEW."provider_command_payload_sha256"
      AND c."provider_request_sha256" = NEW."provider_request_sha256"
      AND c."provider_idempotency_key" = NEW."provider_idempotency_key"
      AND c."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
      AND c."correlation_id" = NEW."correlation_id"
      AND c."state" = NEW."provider_command_state"
      AND CASE NEW."payload"->>'transitionKind'
        WHEN 'enqueued' THEN
          c."state" = 'pending' AND c."revision" = 0 AND NEW."claim_token" IS NULL
        WHEN 'claimed' THEN
          c."state" = 'claimed' AND c."revision" > 0
          AND c."claim_token" = NEW."claim_token"
        WHEN 'claim_released' THEN
          c."state" = 'pending' AND c."revision" > 0
          AND c."claim_token" IS NULL AND NEW."claim_token" IS NOT NULL
        WHEN 'cancelled' THEN
          c."state" = 'cancelled' AND c."revision" > 0 AND NEW."claim_token" IS NULL
        ELSE false
      END;
    IF transition_command_ok IS DISTINCT FROM true
       OR transition_recorded_at IS NULL
       OR NEW."payload" IS DISTINCT FROM expected_transition_payload
       OR NEW."actor_kind" IS DISTINCT FROM transition_actor_kind
       OR NEW."actor_key" IS DISTINCT FROM transition_actor_key
       OR NEW."actor_user_id" IS DISTINCT FROM transition_actor_user_id
       OR NEW."idempotency_key" IS DISTINCT FROM
            'provider-command-transition:' || NEW."provider_command_id"::text
              || ':' || transition_command_revision::text
       OR NEW."request_digest" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
            'omnitwin.foundry.provider-command-transition.v0', NEW."payload"
          )
       OR NEW."advances_projection" IS DISTINCT FROM (
            (
              NEW."payload"->>'transitionKind' = 'enqueued'
              AND NEW."provider_command_kind" = 'provider_submit'
            ) OR (
              NEW."payload"->>'transitionKind' IN ('claimed', 'claim_released')
              AND NEW."provider_command_kind" IN ('provider_checkpoint', 'provider_stop')
            )
          ) THEN
      RAISE EXCEPTION 'provider command transition event lost its exact command, actor, or projection binding'
        USING ERRCODE = '23514';
    END IF;
    NEW."recorded_at" := transition_recorded_at;
  ELSIF NEW."event_kind" = 'provider_invocation_started' THEN
    invocation_at := clock_timestamp();
    NEW."recorded_at" := invocation_at;
    SELECT true INTO invocation_command_ok
    FROM "foundry_provider_commands" c
    WHERE c."id" = NEW."provider_command_id"
      AND c."execution_id" = NEW."execution_id"
      AND c."project_id" = NEW."project_id"
      AND c."job_id" = NEW."job_id"
      AND c."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND c."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND c."provider_kind" = NEW."provider_kind"
      AND c."provider_adapter_id" = NEW."provider_adapter_id"
      AND c."provider_adapter_version" = NEW."provider_adapter_version"
      AND c."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND c."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND c."attempt_id" = NEW."attempt_id"
      AND c."attempt_ordinal" = NEW."attempt_ordinal"
      AND c."fencing_token" = NEW."fencing_token"
      AND c."command_kind" = NEW."provider_command_kind"
      AND c."claim_token" = NEW."claim_token"
      AND c."payload_sha256" = NEW."provider_command_payload_sha256"
      AND c."provider_request_sha256" = NEW."provider_request_sha256"
      AND c."provider_idempotency_key" = NEW."provider_idempotency_key"
      AND c."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
      AND c."correlation_id" = NEW."correlation_id"
      AND c."state" = 'claimed'
      AND c."claimed_by" = NEW."actor_key"
      AND c."claimed_at" <= invocation_at
      AND invocation_at + make_interval(secs => c."maximum_api_call_seconds" + 1)
            <= c."claim_expires_at"
      AND NEW."actor_kind" = 'service'
      AND invocation_at >= statement_timestamp()
      AND invocation_at <= clock_timestamp();
    IF invocation_command_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'provider invocation start must causally bind the exact live claimed command fence'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."provider_command_kind" = 'provider_submit' THEN
      SELECT true INTO invocation_submit_ok
      FROM "foundry_executions" e
      JOIN "foundry_attempts" a
        ON a."execution_id" = e."id"
       AND a."id" = NEW."attempt_id"
       AND a."fencing_token" = NEW."fencing_token"
      JOIN "foundry_provider_commands" c
        ON c."id" = NEW."provider_command_id"
       AND c."execution_id" = e."id"
       AND c."attempt_id" = a."id"
       AND c."fencing_token" = a."fencing_token"
       AND c."command_kind" = 'provider_submit'
       AND c."state" = 'claimed'
      WHERE e."id" = NEW."execution_id"
        AND e."fencing_token" = NEW."fencing_token"
        AND e."state" = 'submit_pending'
        AND a."state" = 'submit_pending'
        AND NOT e."cancel_requested"
        AND NOT a."cancel_requested"
        AND invocation_at < e."dispatch_deadline"
        AND e."total_cost_micro_usd" < e."cost_hard_stop_micro_usd"
        AND e."total_cost_micro_usd" + e."termination_reserve_micro_usd"
              <= e."absolute_cost_cap_micro_usd"
        AND "foundry_execution_authority_is_current"(
              e."id",
              invocation_at + make_interval(
                secs => c."maximum_api_call_seconds" + 1
              )
            )
        AND EXISTS (
          SELECT 1
          FROM "foundry_provider_request_profiles" request_profile
          WHERE request_profile."provider_request_profile_sha256" =
                  c."provider_request_profile_sha256"
            AND request_profile."profile_id" = c."provider_request_profile_id"
            AND request_profile."profile_version" = c."provider_request_profile_version"
            AND request_profile."provider_kind" = c."provider_kind"
            AND request_profile."provider_adapter_id" = c."provider_adapter_id"
            AND request_profile."provider_adapter_version" = c."provider_adapter_version"
            AND request_profile."provider_adapter_artifact_sha256" =
                  c."provider_adapter_artifact_sha256"
            AND request_profile."provider_adapter_configuration_sha256" =
                  c."provider_adapter_configuration_sha256"
            AND request_profile."provider_deployment_sha256" =
                  c."provider_deployment_sha256"
            AND request_profile."reviewed_at" <= invocation_at
            AND request_profile."expires_at" > invocation_at + make_interval(
                  secs => c."maximum_api_call_seconds" + 1
                )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "foundry_kill_switches" k
          WHERE k."state" = 'active' AND (
            k."scope" = 'global'
            OR (k."scope" = 'provider' AND k."provider_kind" = e."provider_kind"
              AND k."provider_adapter_id" = e."provider_adapter_id"
              AND k."provider_adapter_version" = e."provider_adapter_version")
            OR (k."scope" = 'project' AND k."project_id" = e."project_id")
            OR (k."scope" = 'execution' AND k."execution_id" = e."id")
            OR (k."scope" = 'attempt' AND k."attempt_id" = a."id")
          )
        )
      FOR UPDATE OF a, e;
      IF invocation_submit_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'provider submit invocation lost authority, cost, deadline, fence, or kill-switch clearance'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      SELECT true INTO invocation_followup_ok
      FROM "foundry_provider_commands" c
      JOIN "foundry_attempts" a
        ON a."id" = c."attempt_id"
       AND a."execution_id" = c."execution_id"
       AND a."fencing_token" = c."fencing_token"
      JOIN "foundry_executions" e
        ON e."id" = a."execution_id"
       AND e."fencing_token" = a."fencing_token"
      WHERE c."id" = NEW."provider_command_id"
        AND c."state" = 'claimed'
        AND left(a."state", 9) <> 'terminal_'
        AND left(e."state", 9) <> 'terminal_'
        AND CASE c."command_kind"
          WHEN 'provider_reconcile' THEN
            a."state" IN ('provider_unknown', 'stop_pending')
            AND c."target_provider_ref" IS NOT DISTINCT FROM a."provider_execution_ref"
          WHEN 'provider_poll' THEN
            a."provider_execution_ref" IS NOT NULL
            AND c."target_provider_ref" = a."provider_execution_ref"
          WHEN 'provider_checkpoint' THEN
            a."state" = 'checkpointing'
            AND NOT a."cancel_requested"
            AND a."provider_execution_ref" IS NOT NULL
            AND c."target_provider_ref" = a."provider_execution_ref"
            AND "foundry_rights_policy_is_active"(
              e."rights_policy_version", e."rights_policy_definition_sha256",
              e."rights_policy_generation",
              invocation_at + make_interval(
                secs => c."maximum_api_call_seconds" + 1
              )
            )
            AND EXISTS (
              SELECT 1
              FROM "foundry_rights_approvals" rights_approval
              WHERE rights_approval."id" = e."rights_approval_id"
                AND rights_approval."rights_approval_sha256" = e."rights_approval_sha256"
                AND rights_approval."expires_at" > invocation_at + make_interval(
                      secs => c."maximum_api_call_seconds" + 1
                    )
            )
            AND EXISTS (
              SELECT 1
              FROM "foundry_provider_request_profiles" request_profile
              WHERE request_profile."provider_request_profile_sha256" =
                      c."provider_request_profile_sha256"
                AND request_profile."profile_id" = c."provider_request_profile_id"
                AND request_profile."profile_version" = c."provider_request_profile_version"
                AND request_profile."provider_kind" = c."provider_kind"
                AND request_profile."provider_adapter_id" = c."provider_adapter_id"
                AND request_profile."provider_adapter_version" = c."provider_adapter_version"
                AND request_profile."provider_adapter_artifact_sha256" =
                      c."provider_adapter_artifact_sha256"
                AND request_profile."provider_adapter_configuration_sha256" =
                      c."provider_adapter_configuration_sha256"
                AND request_profile."provider_deployment_sha256" =
                      c."provider_deployment_sha256"
                AND request_profile."reviewed_at" <= invocation_at
                AND request_profile."expires_at" > invocation_at + make_interval(
                      secs => c."maximum_api_call_seconds" + 1
                    )
            )
          WHEN 'provider_stop' THEN
            a."state" = 'terminating'
            AND a."cancel_requested"
            AND a."provider_execution_ref" IS NOT NULL
            AND c."target_provider_ref" = a."provider_execution_ref"
            AND c."stop_intent_id" IS NOT NULL
          ELSE false
        END
      FOR UPDATE OF a, e;
      IF invocation_followup_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'provider follow-up invocation lost its live fenced resource or containment state'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  ELSIF NEW."event_kind" = 'provider_command_completed' THEN
    SELECT true, c."completed_at", c."completed_by_actor_kind", c."completed_by_actor_key"
    INTO command_event_ok, command_completed_at, command_actor_kind, command_actor_key
    FROM "foundry_provider_commands" c
    WHERE c."id" = NEW."provider_command_id"
      AND c."execution_id" = NEW."execution_id"
      AND c."project_id" = NEW."project_id"
      AND c."job_id" = NEW."job_id"
      AND c."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND c."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND c."provider_kind" = NEW."provider_kind"
      AND c."provider_adapter_id" = NEW."provider_adapter_id"
      AND c."provider_adapter_version" = NEW."provider_adapter_version"
      AND c."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND c."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND c."attempt_id" = NEW."attempt_id"
      AND c."attempt_ordinal" = NEW."attempt_ordinal"
      AND c."fencing_token" = NEW."fencing_token"
      AND c."command_kind" = NEW."provider_command_kind"
      AND c."claim_token" = NEW."claim_token"
      AND c."payload_sha256" = NEW."provider_command_payload_sha256"
      AND c."provider_request_sha256" = NEW."provider_request_sha256"
      AND c."provider_idempotency_key" = NEW."provider_idempotency_key"
      AND c."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
      AND c."state" = NEW."provider_command_state"
      AND c."outcome_sha256" = NEW."provider_command_outcome_sha256"
      AND c."provider_lifecycle_state" = NEW."provider_lifecycle_state"
      AND c."outcome_json" = NEW."payload"
      AND c."correlation_id" = NEW."correlation_id"
      AND c."state" IN ('succeeded', 'failed', 'uncertain');
    IF command_event_ok IS DISTINCT FROM true
       OR NEW."actor_kind" IS DISTINCT FROM command_actor_kind
       OR NEW."actor_key" IS DISTINCT FROM command_actor_key
       OR NEW."actor_user_id" IS NOT NULL THEN
      RAISE EXCEPTION 'provider completion event must bind the exact terminal command outcome and completion actor'
        USING ERRCODE = '23514';
    END IF;
    SELECT EXISTS (
      SELECT 1
      FROM "foundry_execution_events" invocation
      WHERE invocation."provider_command_id" = NEW."provider_command_id"
        AND invocation."claim_token" = NEW."claim_token"
        AND invocation."correlation_id" = NEW."correlation_id"
        AND invocation."event_kind" = 'provider_invocation_started'
    ) INTO matching_invocation_exists;
    IF NEW."provider_was_invoked" IS DISTINCT FROM matching_invocation_exists
       OR (
         NOT NEW."provider_was_invoked"
         AND (
           NEW."provider_command_state" <> 'failed'
           OR NEW."provider_lifecycle_state" <> 'not_observed'
         )
       ) THEN
      RAISE EXCEPTION 'provider completion invocation disposition does not match its exact claim ledger'
        USING ERRCODE = '23514';
    END IF;
    NEW."recorded_at" := command_completed_at;
  ELSIF NEW."event_kind" = 'stop_intent_applied' THEN
    SELECT true, stop_intent."recorded_at", stop_intent."actor_kind",
           stop_intent."actor_key", stop_intent."actor_user_id",
           jsonb_build_object(
             'schemaVersion', 'omnitwin.foundry.stop-intent-applied.v0',
             'stopIntentId', stop_intent."id"::text,
             'reasonCode', stop_intent."reason_code",
             'targetTerminalState', stop_intent."target_terminal_state",
             'sourceKind', stop_intent."source_kind",
             'sourceId', stop_intent."source_id"::text,
             'sourceDigest', stop_intent."source_digest",
             'attemptState', attempt."state",
             'cancelRequested', attempt."cancel_requested"
           )
    INTO stop_intent_event_ok, stop_intent_recorded_at, stop_intent_actor_kind,
         stop_intent_actor_key, stop_intent_actor_user_id,
         expected_stop_intent_payload
    FROM "foundry_stop_intents" stop_intent
    JOIN "foundry_attempts" attempt
      ON attempt."id" = stop_intent."attempt_id"
     AND attempt."execution_id" = stop_intent."execution_id"
     AND attempt."fencing_token" = stop_intent."fencing_token"
    WHERE stop_intent."id"::text = NEW."payload"->>'stopIntentId'
      AND stop_intent."id" = NEW."causation_id"
      AND stop_intent."execution_id" = NEW."execution_id"
      AND stop_intent."project_id" = NEW."project_id"
      AND stop_intent."job_id" = NEW."job_id"
      AND stop_intent."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND stop_intent."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND stop_intent."provider_kind" = NEW."provider_kind"
      AND stop_intent."provider_adapter_id" = NEW."provider_adapter_id"
      AND stop_intent."provider_adapter_version" = NEW."provider_adapter_version"
      AND stop_intent."provider_adapter_artifact_sha256" =
            NEW."provider_adapter_artifact_sha256"
      AND stop_intent."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND stop_intent."attempt_id" = NEW."attempt_id"
      AND stop_intent."attempt_ordinal" = NEW."attempt_ordinal"
      AND stop_intent."fencing_token" = NEW."fencing_token"
      AND stop_intent."correlation_id" = NEW."correlation_id";
    IF stop_intent_event_ok IS DISTINCT FROM true
       OR NEW."payload" IS DISTINCT FROM expected_stop_intent_payload
       OR NEW."actor_kind" IS DISTINCT FROM stop_intent_actor_kind
       OR NEW."actor_key" IS DISTINCT FROM stop_intent_actor_key
       OR NEW."actor_user_id" IS DISTINCT FROM stop_intent_actor_user_id
       OR NEW."idempotency_key" IS DISTINCT FROM
            'stop-intent-applied:' || NEW."causation_id"::text
       OR NEW."request_digest" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
            'omnitwin.foundry.stop-intent-applied.v0', NEW."payload"
          ) THEN
      RAISE EXCEPTION 'stop-intent application event lost its exact source, actor, or projection binding'
        USING ERRCODE = '23514';
    END IF;
    NEW."recorded_at" := stop_intent_recorded_at;
  ELSIF NEW."event_kind" = 'cost_observation_applied' THEN
    SELECT true, cost."recorded_at", cost."recorded_by",
           jsonb_build_object(
             'schemaVersion', 'omnitwin.foundry.cost-observation-applied.v0',
             'costObservationId', cost."id"::text,
             'observationSequence', cost."observation_sequence"::text,
             'providerObservationId', cost."provider_observation_id",
             'observationKind', cost."observation_kind",
             'pricingCurrency', cost."pricing_currency",
             'pricingSnapshotSha256', cost."pricing_snapshot_sha256",
             'incrementalCostMicroUsd', cost."incremental_cost_micro_usd"::text,
             'cumulativeCostMicroUsd', cost."cumulative_cost_micro_usd"::text,
             'evidenceSha256', cost."evidence_sha256",
             'providerObservedAt', to_char(
               cost."provider_observed_at" AT TIME ZONE 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'
             ),
             'observationRequestDigest', cost."request_digest",
             'resultingAttemptCostMicroUsd', attempt."observed_cost_micro_usd"::text,
             'resultingExecutionTotalMicroUsd', execution."total_cost_micro_usd"::text
           )
    INTO cost_event_ok, cost_recorded_at, cost_actor_key, expected_cost_payload
    FROM "foundry_cost_observations" cost
    JOIN "foundry_attempts" attempt
      ON attempt."id" = cost."attempt_id"
     AND attempt."execution_id" = cost."execution_id"
     AND attempt."fencing_token" = cost."fencing_token"
    JOIN "foundry_executions" execution
      ON execution."id" = cost."execution_id"
     AND execution."fencing_token" = cost."fencing_token"
    WHERE cost."id"::text = NEW."payload"->>'costObservationId'
      AND cost."id" = NEW."causation_id"
      AND cost."execution_id" = NEW."execution_id"
      AND cost."project_id" = NEW."project_id"
      AND cost."job_id" = NEW."job_id"
      AND cost."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND cost."provider_kind" = NEW."provider_kind"
      AND cost."provider_adapter_id" = NEW."provider_adapter_id"
      AND cost."provider_adapter_version" = NEW."provider_adapter_version"
      AND cost."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND cost."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND cost."attempt_id" = NEW."attempt_id"
      AND cost."attempt_ordinal" = NEW."attempt_ordinal"
      AND cost."fencing_token" = NEW."fencing_token"
      AND cost."correlation_id" = NEW."correlation_id";
    IF cost_event_ok IS DISTINCT FROM true
       OR NEW."payload" IS DISTINCT FROM expected_cost_payload
       OR NEW."actor_kind" <> 'service'
       OR NEW."actor_key" IS DISTINCT FROM cost_actor_key
       OR NEW."actor_user_id" IS NOT NULL
       OR NEW."idempotency_key" IS DISTINCT FROM
            'cost-observation-applied:' || NEW."causation_id"::text
       OR NEW."request_digest" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
            'omnitwin.foundry.cost-observation-applied.v0', NEW."payload"
          ) THEN
      RAISE EXCEPTION 'cost-observation event lost its exact source, actor, or projection binding'
        USING ERRCODE = '23514';
    END IF;
    NEW."recorded_at" := cost_recorded_at;
  ELSIF NEW."event_kind" = 'operator_cancel_requested' THEN
    NEW."recorded_at" := clock_timestamp();
    IF NEW."advances_projection"
       OR NEW."attempt_id" IS NULL
       OR NEW."actor_kind" <> 'operator'
       OR NEW."actor_user_id" IS NULL
       OR "foundry_jsonb_object_key_count"(NEW."payload") <> 1
       OR NEW."payload"->>'reasonCode' <> 'operator_cancel' THEN
      RAISE EXCEPTION 'operator cancellation source event is not exact or audit-only'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."event_kind" = 'runtime_deadline_elapsed' THEN
    NEW."recorded_at" := clock_timestamp();
    SELECT CASE NEW."payload"->>'reasonCode'
      WHEN 'wall_clock_deadline' THEN a."wall_clock_deadline"
      WHEN 'cancel_deadline' THEN a."cancel_deadline"
      WHEN 'termination_deadline' THEN a."termination_deadline"
      WHEN 'worker_self_deadline' THEN a."worker_self_deadline"
      WHEN 'provider_ttl_deadline' THEN a."provider_ttl_deadline"
      ELSE NULL
    END
    INTO runtime_deadline
    FROM "foundry_attempts" a
    WHERE a."id" = NEW."attempt_id"
      AND a."execution_id" = NEW."execution_id"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE;
    IF NOT FOUND
       OR NEW."advances_projection"
       OR NEW."attempt_id" IS NULL
       OR NEW."actor_kind" NOT IN ('service', 'watchdog', 'system')
       OR NEW."actor_user_id" IS NOT NULL
       OR "foundry_jsonb_object_key_count"(NEW."payload") <> 2
       OR NOT (NEW."payload" ?& ARRAY['reasonCode', 'deadline'])
       OR runtime_deadline IS NULL
       OR (NEW."payload"->>'deadline')::timestamptz IS DISTINCT FROM runtime_deadline
       OR runtime_deadline > NEW."recorded_at" THEN
      RAISE EXCEPTION 'runtime deadline source event is not exact, elapsed, or audit-only'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."event_kind" <> 'execution_admitted' THEN
    NEW."recorded_at" := clock_timestamp();
  END IF;
  IF NEW."event_kind" = 'execution_admitted' AND (
       current_revision <> 0
       OR NEW."advances_projection"
       OR NEW."attempt_id" IS NOT NULL
       OR NEW."provider_command_id" IS NOT NULL
       OR NEW."recorded_at" IS DISTINCT FROM admitted
     ) THEN
    RAISE EXCEPTION 'execution admission genesis event must bind the inert revision-zero projection'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(MAX(e."sequence"), 0) + 1,
         COALESCE(MAX(e."resulting_revision"), 0)
  INTO expected_sequence, expected_event_revision
  FROM "foundry_execution_events" e WHERE e."execution_id" = NEW."execution_id";
  IF NEW."event_kind" = 'stop_intent_applied' THEN
    projection_delta := current_revision - expected_event_revision;
    IF projection_delta NOT IN (0, 1)
       OR NEW."advances_projection" IS DISTINCT FROM (projection_delta = 1) THEN
      RAISE EXCEPTION 'stop-intent event must exactly account for its containment projection revision'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."event_kind" = 'cost_observation_applied' THEN
    projection_delta := current_revision - expected_event_revision;
    IF projection_delta NOT IN (0, 1)
       OR NEW."advances_projection" IS DISTINCT FROM (projection_delta = 1)
       OR NEW."advances_projection" IS DISTINCT FROM
            ((NEW."payload"->>'incrementalCostMicroUsd')::numeric > 0) THEN
      RAISE EXCEPTION 'cost-observation event must exactly account for its cost projection revision'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."event_kind" = 'provider_command_transitioned'
     AND NEW."advances_projection" THEN
    projection_delta := current_revision - expected_event_revision;
    IF projection_delta <> 1 THEN
      RAISE EXCEPTION 'provider command transition must close exactly one local projection revision'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."event_kind" = 'provider_command_completed' THEN
    projection_delta := current_revision - expected_event_revision;
    IF projection_delta NOT IN (0, 1)
       OR NEW."advances_projection" IS DISTINCT FROM (projection_delta = 1) THEN
      RAISE EXCEPTION 'provider completion event must exactly account for its projection revision delta'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."sequence" <> expected_sequence
     OR NEW."expected_revision" <> expected_event_revision
      OR (
        NEW."event_kind" = 'execution_admitted'
        AND NEW."resulting_revision" <> expected_event_revision
      )
      OR (
        NEW."event_kind" <> 'execution_admitted'
        AND NEW."resulting_revision" <> expected_event_revision
          + CASE WHEN NEW."advances_projection" THEN 1 ELSE 0 END
      )
     OR NEW."recorded_at" < admitted THEN
    RAISE EXCEPTION 'execution event sequence or revision is not contiguous' USING ERRCODE = '40001';
  END IF;
  IF NEW."resulting_revision" > current_revision THEN
    RAISE EXCEPTION 'execution event cannot claim an unapplied projection revision' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "foundry_provider_result_terminal_disposition"(
  observation_id_input uuid,
  completion_event_id_input uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  observation "foundry_provider_command_result_observations"%ROWTYPE;
  command "foundry_provider_commands"%ROWTYPE;
  completion "foundry_execution_events"%ROWTYPE;
  base_outcome_matches boolean;
  checkpoint_matches boolean;
  late_unknown_closure boolean;
  discovered_reference_matches boolean;
BEGIN
  SELECT * INTO observation
  FROM "foundry_provider_command_result_observations"
  WHERE "id" = observation_id_input;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO command
  FROM "foundry_provider_commands"
  WHERE "id" = observation."provider_command_id";
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO completion
  FROM "foundry_execution_events"
  WHERE "id" = completion_event_id_input;
  IF NOT FOUND
     OR completion."event_kind" <> 'provider_command_completed'
     OR completion."provider_command_id" IS DISTINCT FROM command."id"
     OR completion."execution_id" IS DISTINCT FROM command."execution_id"
     OR completion."attempt_id" IS DISTINCT FROM command."attempt_id"
     OR completion."fencing_token" IS DISTINCT FROM command."fencing_token"
     OR completion."provider_command_kind" IS DISTINCT FROM command."command_kind"
     OR completion."claim_token" IS DISTINCT FROM command."claim_token"
     OR completion."provider_command_payload_sha256" IS DISTINCT FROM command."payload_sha256"
     OR completion."provider_request_sha256" IS DISTINCT FROM command."provider_request_sha256"
     OR completion."provider_idempotency_key" IS DISTINCT FROM command."provider_idempotency_key"
     OR completion."maximum_api_call_seconds" IS DISTINCT FROM command."maximum_api_call_seconds"
     OR completion."provider_command_state" IS DISTINCT FROM command."state"
     OR completion."provider_command_outcome_sha256" IS DISTINCT FROM command."outcome_sha256"
     OR completion."provider_lifecycle_state" IS DISTINCT FROM command."provider_lifecycle_state"
     OR completion."payload" IS DISTINCT FROM command."outcome_json"
     OR completion."actor_kind" IS DISTINCT FROM command."completed_by_actor_kind"
     OR completion."actor_key" IS DISTINCT FROM command."completed_by_actor_key"
     OR completion."correlation_id" IS DISTINCT FROM command."correlation_id"
     OR completion."recorded_at" IS DISTINCT FROM command."completed_at" THEN
    RETURN NULL;
  END IF;

  base_outcome_matches :=
    observation."adapter_outcome_json" - 'verifiedCheckpoint' =
      command."outcome_json" - ARRAY[
        'schemaVersion', 'commandId', 'executionId', 'attemptId', 'claimToken',
        'fencingToken', 'completedBy'
      ];
  checkpoint_matches := NOT (observation."adapter_outcome_json" ? 'verifiedCheckpoint');
  IF observation."adapter_outcome_json" ? 'verifiedCheckpoint' THEN
    SELECT EXISTS (
      SELECT 1
      FROM "foundry_verified_checkpoints" checkpoint
      WHERE checkpoint."provider_command_id" = command."id"
        AND checkpoint."execution_id" = command."execution_id"
        AND checkpoint."attempt_id" = command."attempt_id"
        AND checkpoint."fencing_token" = command."fencing_token"
        AND checkpoint."provider_command_outcome_sha256" = command."outcome_sha256"
        AND checkpoint."checkpoint_sha256" =
              observation."adapter_outcome_json"->'verifiedCheckpoint'->>'checkpointSha256'
        AND command."outcome_json"->>'evidenceSha256' =
              "foundry_verified_checkpoint_evidence_sha256"(
                checkpoint."checkpoint_kind", checkpoint."provider_checkpoint_id",
                checkpoint."checkpoint_sha256", checkpoint."evidence_ref",
                checkpoint."provider_created_at"
              )
        AND jsonb_build_object(
          'schemaVersion', 'omnitwin.foundry.provider-checkpoint-evidence.v0',
          'checkpointKind', checkpoint."checkpoint_kind",
          'checkpointSha256', checkpoint."checkpoint_sha256",
          'evidenceRef', checkpoint."evidence_ref",
          'providerCheckpointId', checkpoint."provider_checkpoint_id",
          'providerCreatedAt', to_char(
            date_trunc('milliseconds', checkpoint."provider_created_at" AT TIME ZONE 'UTC'),
            'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"'
          )
        ) = observation."adapter_outcome_json"->'verifiedCheckpoint'
    ) INTO checkpoint_matches;
  END IF;

  late_unknown_closure :=
    completion."provider_was_invoked" = true
    AND command."state" = 'uncertain'
    AND command."provider_lifecycle_state" = 'unknown'
    AND (
      (
        command."completed_by_actor_kind" = 'service'
        AND command."completed_by_actor_key" = command."claimed_by"
        AND command."outcome_json"->>'outcomeCode' = 'adapter_timeout_unknown'
      ) OR (
        command."completed_by_actor_kind" = 'watchdog'
        AND command."outcome_json"->>'outcomeCode' = 'claim_lease_expired_effect_unknown'
      )
    );
  discovered_reference_matches :=
    command."command_kind" <> 'provider_submit'
    OR command."provider_command_ref" IS NULL
    OR observation."adapter_outcome_json"->>'providerCommandRef' IS NOT DISTINCT FROM
         command."provider_command_ref";

  IF late_unknown_closure AND discovered_reference_matches THEN
    RETURN 'late_eligible';
  ELSIF completion."provider_was_invoked" = true
        AND command."state" IN ('succeeded', 'failed')
        AND base_outcome_matches
        AND checkpoint_matches THEN
    RETURN 'already_authoritative';
  ELSIF command."state" IN ('succeeded', 'failed')
        OR (late_unknown_closure AND NOT discovered_reference_matches) THEN
    RETURN 'terminal_conflict';
  END IF;
  RETURN 'not_eligible';
END;
$$;

CREATE FUNCTION "guard_foundry_provider_result_observation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  receipt_now timestamptz;
  command_ok boolean;
  target_provider_ref varchar(240);
  command_correlation_id uuid;
  command_claimed_at timestamptz;
BEGIN
  receipt_now := clock_timestamp();
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  SELECT true, command."target_provider_ref", command."correlation_id", command."claimed_at"
  INTO command_ok, target_provider_ref, command_correlation_id, command_claimed_at
  FROM "foundry_provider_commands" command
  JOIN "foundry_execution_events" invocation
    ON invocation."id" = NEW."invocation_event_id"
   AND invocation."provider_command_id" = command."id"
   AND invocation."event_kind" = 'provider_invocation_started'
   AND invocation."execution_id" = command."execution_id"
   AND invocation."attempt_id" = command."attempt_id"
   AND invocation."fencing_token" = command."fencing_token"
   AND invocation."provider_command_kind" = command."command_kind"
   AND invocation."claim_token" = command."claim_token"
   AND invocation."provider_command_payload_sha256" = command."payload_sha256"
   AND invocation."provider_request_sha256" = command."provider_request_sha256"
   AND invocation."provider_idempotency_key" = command."provider_idempotency_key"
   AND invocation."maximum_api_call_seconds" = command."maximum_api_call_seconds"
   AND invocation."actor_kind" = 'service'
   AND invocation."actor_key" = command."claimed_by"
   AND invocation."correlation_id" = command."correlation_id"
  WHERE command."id" = NEW."provider_command_id"
    AND command."execution_id" = NEW."execution_id"
    AND command."project_id" = NEW."project_id"
    AND command."job_id" = NEW."job_id"
    AND command."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND command."execution_subject_sha256" = NEW."execution_subject_sha256"
    AND command."provider_kind" = NEW."provider_kind"
    AND command."provider_adapter_id" = NEW."provider_adapter_id"
    AND command."provider_adapter_version" = NEW."provider_adapter_version"
    AND command."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND command."provider_adapter_configuration_sha256" = NEW."provider_adapter_configuration_sha256"
    AND command."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND command."prepared_provider_request_id" = NEW."prepared_provider_request_id"
    AND command."provider_request_profile_id" = NEW."provider_request_profile_id"
    AND command."provider_request_profile_version" = NEW."provider_request_profile_version"
    AND command."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
    AND command."provider_request_sha256" = NEW."provider_request_sha256"
    AND command."provider_idempotency_key" = NEW."provider_idempotency_key"
    AND command."provider_client_request_id" = NEW."provider_client_request_id"
    AND command."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
    AND command."payload_sha256" = NEW."command_payload_sha256"
    AND command."attempt_id" = NEW."attempt_id"
    AND command."attempt_ordinal" = NEW."attempt_ordinal"
    AND command."fencing_token" = NEW."fencing_token"
    AND command."command_sequence" = NEW."command_sequence"
    AND command."command_kind" = NEW."command_kind"
    AND command."claim_token" = NEW."claim_token"
    AND command."claimed_by" = NEW."claimed_by"
  FOR UPDATE OF command;
  IF command_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'provider result observation requires one exact invoked command claim and immutable request binding'
      USING ERRCODE = '55000';
  END IF;
  IF NEW."actor_kind" <> 'service'
     OR NEW."actor_key" IS DISTINCT FROM NEW."claimed_by"
     OR NEW."idempotency_key" IS DISTINCT FROM
          'provider-command-result-observation:' || NEW."provider_command_id"::text || ':' || NEW."claim_token"::text
     OR NEW."causation_id" IS DISTINCT FROM NEW."invocation_event_id"
     OR NEW."correlation_id" IS DISTINCT FROM command_correlation_id
     OR NEW."worker_observed_at" < command_claimed_at - interval '10 minutes'
     OR NEW."worker_observed_at" > receipt_now + interval '10 minutes'
     OR NEW."adapter_outcome_sha256" IS DISTINCT FROM
          "foundry_domain_jsonb_sha256"(
            'omnitwin.foundry.provider-adapter-outcome.v0', NEW."adapter_outcome_json"
          )
     OR "foundry_provider_adapter_outcome_is_valid"(
          NEW."command_kind", target_provider_ref, NEW."adapter_outcome_json"
        ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'provider result observation lost its exact invocation, actor, time, or canonical conclusive outcome binding'
      USING ERRCODE = '23514';
  END IF;
  NEW."recorded_at" := receipt_now;
  NEW."request_digest" := "foundry_provider_result_observation_request_digest"(NEW);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_provider_result_classification"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  classification_now timestamptz;
  expected_disposition text;
  observation_correlation_id uuid;
  observation_scope record;
BEGIN
  classification_now := clock_timestamp();
  SELECT observation."provider_kind", observation."provider_adapter_id",
         observation."provider_adapter_version", observation."project_id",
         observation."execution_id", observation."attempt_id",
         observation."correlation_id"
  INTO observation_scope
  FROM "foundry_provider_command_result_observations" observation
  WHERE observation."id" = NEW."observation_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider result classification requires one exact observation'
      USING ERRCODE = '55000';
  END IF;
  PERFORM "foundry_lock_execution_control_scopes"(
    observation_scope."provider_kind", observation_scope."provider_adapter_id",
    observation_scope."provider_adapter_version", observation_scope."project_id",
    observation_scope."execution_id", observation_scope."attempt_id"
  );
  SELECT observation."correlation_id"
  INTO observation_correlation_id
  FROM "foundry_provider_command_result_observations" observation
  JOIN "foundry_provider_commands" command
    ON command."id" = observation."provider_command_id"
  JOIN "foundry_execution_events" completion
    ON completion."id" = NEW."completion_event_id"
  WHERE observation."id" = NEW."observation_id"
    AND observation."provider_command_id" = NEW."provider_command_id"
    AND completion."provider_command_id" = command."id"
  FOR UPDATE OF observation, command, completion;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider result classification lost its exact observation, command, or completion event'
      USING ERRCODE = '55000';
  END IF;
  expected_disposition := "foundry_provider_result_terminal_disposition"(
    NEW."observation_id", NEW."completion_event_id"
  );
  IF expected_disposition IS NULL
     OR NEW."disposition" IS DISTINCT FROM expected_disposition
     OR NEW."terminal_outcome_sha256" IS DISTINCT FROM (
          SELECT event."provider_command_outcome_sha256"
          FROM "foundry_execution_events" event
          WHERE event."id" = NEW."completion_event_id"
        )
     OR NEW."actor_kind" <> 'system'
     OR NEW."actor_key" <> 'foundry-provider-result-classifier'
     OR NEW."idempotency_key" IS DISTINCT FROM
          'provider-command-result-classification:' || NEW."observation_id"::text
     OR NEW."causation_id" IS DISTINCT FROM NEW."observation_id"
     OR NEW."correlation_id" IS DISTINCT FROM observation_correlation_id THEN
    RAISE EXCEPTION 'provider result classification is not the exact immutable terminal interpretation of its observation'
      USING ERRCODE = '23514';
  END IF;
  NEW."classified_at" := classification_now;
  NEW."request_digest" := "foundry_provider_result_classification_request_digest"(NEW);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_provider_command"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  attempt_state varchar(40);
  exec_state varchar(40);
  exec_fence bigint;
  exec_total bigint;
  exec_hard_stop bigint;
  exec_reserve bigint;
  exec_absolute bigint;
  exec_deadline timestamptz;
  rights_policy_version varchar(120);
  rights_policy_definition_sha256 varchar(71);
  rights_policy_generation bigint;
  exec_lease_ttl_seconds integer;
  attempt_cancel_requested boolean;
  exec_cancel_requested boolean;
  attempt_provider_execution_ref varchar(240);
  stop_terminal_state varchar(40);
  originating_submit_ok boolean;
  prepared_request_ok boolean;
  expected_sequence bigint;
  command_now timestamptz;
  claim_invocation_exists boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    command_now := clock_timestamp();
    NEW."created_at" := command_now;
    NEW."updated_at" := command_now;
    NEW."available_at" := GREATEST(NEW."available_at", command_now);
    SELECT e."rights_policy_version" INTO rights_policy_version
    FROM "foundry_executions" e
    WHERE e."id" = NEW."execution_id";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider command execution scope is absent' USING ERRCODE = '23503';
    END IF;
    PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
    PERFORM "foundry_lock_execution_control_scopes"(
      NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
      NEW."project_id", NEW."execution_id", NEW."attempt_id"
    );
    SELECT a."state", e."state", e."fencing_token", e."total_cost_micro_usd",
           e."cost_hard_stop_micro_usd", e."termination_reserve_micro_usd",
           e."absolute_cost_cap_micro_usd", e."dispatch_deadline",
           e."rights_policy_version", e."rights_policy_definition_sha256", e."rights_policy_generation",
           a."provider_execution_ref", a."cancel_requested"
    INTO attempt_state, exec_state, exec_fence, exec_total, exec_hard_stop,
         exec_reserve, exec_absolute, exec_deadline,
          rights_policy_version, rights_policy_definition_sha256, rights_policy_generation,
          attempt_provider_execution_ref, attempt_cancel_requested
    FROM "foundry_attempts" a
    JOIN "foundry_executions" e ON e."id" = a."execution_id"
    WHERE a."id" = NEW."attempt_id"
      AND a."execution_id" = NEW."execution_id"
      AND a."project_id" = NEW."project_id"
      AND a."job_id" = NEW."job_id"
      AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
      AND a."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND a."provider_kind" = NEW."provider_kind"
      AND a."provider_adapter_id" = NEW."provider_adapter_id"
      AND a."provider_adapter_version" = NEW."provider_adapter_version"
      AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND a."attempt_ordinal" = NEW."attempt_ordinal"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF a, e;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider command attempt scope is absent' USING ERRCODE = '23503';
    END IF;
    IF NEW."command_kind" <> 'provider_stop' AND EXISTS (
      SELECT 1
      FROM "foundry_provider_commands" active_command
      WHERE active_command."attempt_id" = NEW."attempt_id"
        AND active_command."fencing_token" = NEW."fencing_token"
        AND active_command."state" IN ('pending', 'claimed')
    ) THEN
      RAISE EXCEPTION 'only one non-stop provider operation may retain active custody per fenced attempt'
        USING ERRCODE = '55000';
    END IF;
    IF jsonb_typeof(NEW."stage_ids") IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'provider command stage IDs must be a bounded array'
        USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(NEW."stage_ids") NOT BETWEEN 1 AND 1000 THEN
      RAISE EXCEPTION 'provider command stage IDs must be a bounded array'
        USING ERRCODE = '23514';
    END IF;
    IF (
      SELECT count(*) <> count(DISTINCT stage_id)
      FROM jsonb_array_elements_text(NEW."stage_ids") AS stage(stage_id)
    ) OR NEW."stage_ids" IS DISTINCT FROM (
      SELECT jsonb_agg(stage_id ORDER BY stage_id)
      FROM jsonb_array_elements_text(NEW."stage_ids") AS stage(stage_id)
    ) OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(NEW."stage_ids") AS stage(stage_id)
      LEFT JOIN "foundry_job_worker_profiles" jwp
        ON jwp."job_id" = NEW."job_id"
       AND jwp."project_id" = NEW."project_id"
       AND jwp."execution_envelope_sha256" = NEW."execution_envelope_sha256"
       AND jwp."stage_id" = stage.stage_id
      WHERE jwp."id" IS NULL
    ) THEN
      RAISE EXCEPTION 'provider command stages must be unique, sorted, and bound to the exact job worker set'
        USING ERRCODE = '23514';
    END IF;
    SELECT true INTO prepared_request_ok
    FROM "foundry_prepared_provider_requests" p
    WHERE p."id" = NEW."prepared_provider_request_id"
      AND p."provider_command_id" = NEW."id"
      AND p."execution_id" = NEW."execution_id"
      AND p."attempt_id" = NEW."attempt_id"
      AND p."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND p."command_sequence" = NEW."command_sequence"
      AND p."command_kind" = NEW."command_kind"
      AND p."stop_intent_id" IS NOT DISTINCT FROM NEW."stop_intent_id"
      AND p."provider_kind" = NEW."provider_kind"
      AND p."provider_adapter_id" = NEW."provider_adapter_id"
      AND p."provider_adapter_version" = NEW."provider_adapter_version"
      AND p."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
      AND p."provider_deployment_sha256" = NEW."provider_deployment_sha256"
      AND p."provider_request_sha256" = NEW."provider_request_sha256"
      AND p."provider_request_json" = NEW."payload"->'providerRequest'
      AND p."provider_request_profile_id" = NEW."provider_request_profile_id"
      AND p."provider_request_profile_version" = NEW."provider_request_profile_version"
      AND p."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
      AND p."provider_adapter_configuration_sha256" =
            NEW."provider_adapter_configuration_sha256"
      AND p."provider_idempotency_key" = NEW."provider_idempotency_key"
      AND p."provider_client_request_id" = NEW."provider_client_request_id"
      AND p."stage_ids" = NEW."stage_ids"
      AND p."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
      AND p."prepared_by_actor_kind" = NEW."created_by_actor_kind"
      AND p."prepared_by_actor_key" = NEW."created_by_actor_key"
      AND p."prepared_by_user_id" IS NOT DISTINCT FROM NEW."created_by_user_id"
      AND p."prepared_at" <= NEW."created_at";
    IF prepared_request_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'provider command does not bind one exact immutable prepared provider request'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."payload_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.provider-command-payload.v0', NEW."payload"
    ) THEN
      RAISE EXCEPTION 'provider command payload digest must bind the exact immutable payload'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."command_kind" = 'provider_reconcile' THEN
      IF attempt_state NOT IN ('provider_unknown', 'stop_pending')
         OR NEW."target_provider_ref" IS DISTINCT FROM attempt_provider_execution_ref
         OR NEW."originating_submit_provider_request_sha256" =
              NEW."provider_request_sha256" THEN
        RAISE EXCEPTION 'provider reconcile requires the exact unresolved fenced attempt and target'
          USING ERRCODE = '23514';
      END IF;
      IF jsonb_typeof(NEW."payload"->'submitLineage') <> 'object'
         OR "foundry_jsonb_object_key_count"(NEW."payload"->'submitLineage') <> 4
         OR NOT (NEW."payload"->'submitLineage' ?& ARRAY[
           'submitCommandId', 'providerIdempotencyKey',
           'providerRequestSha256', 'executionSubjectSha256'
         ])
         OR jsonb_typeof(NEW."payload"->'submitLineage'->'submitCommandId')
              IS DISTINCT FROM 'string'
         OR jsonb_typeof(NEW."payload"->'submitLineage'->'providerIdempotencyKey')
              IS DISTINCT FROM 'string'
         OR jsonb_typeof(NEW."payload"->'submitLineage'->'providerRequestSha256')
              IS DISTINCT FROM 'string'
         OR jsonb_typeof(NEW."payload"->'submitLineage'->'executionSubjectSha256')
              IS DISTINCT FROM 'string'
         OR NEW."payload"->'submitLineage'->>'submitCommandId'
              IS DISTINCT FROM NEW."originating_submit_command_id"::text
         OR NEW."payload"->'submitLineage'->>'providerIdempotencyKey'
              IS DISTINCT FROM NEW."originating_submit_provider_idempotency_key"
         OR NEW."payload"->'submitLineage'->>'providerRequestSha256'
              IS DISTINCT FROM NEW."originating_submit_provider_request_sha256"
         OR NEW."payload"->'submitLineage'->>'executionSubjectSha256'
              IS DISTINCT FROM NEW."execution_subject_sha256"
         OR NEW."payload"->'providerRequest'->'action'->>'submitCommandId'
              IS DISTINCT FROM NEW."originating_submit_command_id"::text
         OR NEW."payload"->'providerRequest'->'action'->>'submitProviderRequestAuthorizationSha256'
              IS DISTINCT FROM NEW."originating_submit_provider_request_sha256" THEN
        RAISE EXCEPTION 'provider reconcile payload does not exactly bind its originating submit lineage'
          USING ERRCODE = '23514';
      END IF;
      SELECT true INTO originating_submit_ok
      FROM "foundry_provider_commands" s
      WHERE s."id" = NEW."originating_submit_command_id"
        AND s."execution_id" = NEW."execution_id"
        AND s."attempt_id" = NEW."attempt_id"
        AND s."fencing_token" = NEW."fencing_token"
        AND s."execution_subject_sha256" = NEW."execution_subject_sha256"
        AND s."command_kind" = 'provider_submit'
        AND s."command_sequence" < NEW."command_sequence"
        AND s."provider_request_sha256" = NEW."originating_submit_provider_request_sha256"
        AND s."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
        AND s."provider_adapter_configuration_sha256" =
              NEW."provider_adapter_configuration_sha256"
        AND s."provider_idempotency_key" = NEW."originating_submit_provider_idempotency_key";
      IF originating_submit_ok IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'provider reconcile does not bind an earlier exact submit command'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NEW."payload"->'submitLineage' IS DISTINCT FROM 'null'::jsonb THEN
        RAISE EXCEPTION 'only provider reconcile may carry submit lineage' USING ERRCODE = '23514';
      END IF;
      IF NEW."command_kind" IN ('provider_poll', 'provider_checkpoint', 'provider_stop')
         AND NEW."target_provider_ref" IS DISTINCT FROM attempt_provider_execution_ref THEN
        RAISE EXCEPTION 'provider follow-up target does not match the fenced attempt provider resource'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW."command_kind" = 'provider_stop' AND (
         NEW."payload"->'providerRequest'->'action'->>'stopIntentId'
           IS DISTINCT FROM NEW."stop_intent_id"::text
         OR NEW."payload"->'providerRequest'->'action'->>'providerCommandRef'
           IS DISTINCT FROM NEW."target_provider_ref"
       ) THEN
      RAISE EXCEPTION 'provider stop payload lost its exact closed authorization causation'
        USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(MAX(c."command_sequence"), 0) + 1 INTO expected_sequence
    FROM "foundry_provider_commands" c WHERE c."attempt_id" = NEW."attempt_id";
    IF NEW."command_sequence" <> expected_sequence
       OR NEW."state" <> 'pending'
       OR NEW."revision" <> 0
       OR NEW."claimed_by" IS NOT NULL
       OR NEW."claim_token" IS NOT NULL
       OR NEW."claimed_at" IS NOT NULL
       OR NEW."claim_expires_at" IS NOT NULL
       OR NEW."outcome_sha256" IS NOT NULL
       OR NEW."completed_by_actor_kind" IS NOT NULL
       OR NEW."completed_by_actor_key" IS NOT NULL
       OR NEW."completed_at" IS NOT NULL
       OR NEW."provider_command_ref" IS NOT NULL
       OR NEW."created_at" <> NEW."updated_at" THEN
      RAISE EXCEPTION 'provider command must enter the inert outbox as the next pending command' USING ERRCODE = '23514';
    END IF;
    IF NEW."command_kind" = 'provider_submit' THEN
      IF attempt_state <> 'authorized' OR exec_state <> 'authorized'
         OR NEW."fencing_token" <> exec_fence
         OR clock_timestamp() >= exec_deadline
         OR exec_total >= exec_hard_stop
         OR exec_total + exec_reserve > exec_absolute THEN
        RAISE EXCEPTION 'provider submit is blocked by state, fence, deadline, or cost policy' USING ERRCODE = '55000';
      END IF;
      IF NOT "foundry_rights_policy_is_active"(
        rights_policy_version, rights_policy_definition_sha256,
        rights_policy_generation, clock_timestamp()
      ) THEN
        RAISE EXCEPTION 'provider submit is blocked by a revoked or ineffective rights policy' USING ERRCODE = '55000';
      END IF;
      IF NOT "foundry_execution_authority_is_current"(NEW."execution_id", clock_timestamp()) THEN
        RAISE EXCEPTION 'provider submit is blocked by expired execution authority' USING ERRCODE = '55000';
      END IF;
      IF EXISTS (
        SELECT 1 FROM "foundry_kill_switches" k
        WHERE k."state" = 'active' AND (
          k."scope" = 'global'
          OR (k."scope" = 'provider' AND k."provider_kind" = NEW."provider_kind"
            AND k."provider_adapter_id" = NEW."provider_adapter_id"
            AND k."provider_adapter_version" = NEW."provider_adapter_version")
          OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
          OR (k."scope" = 'execution' AND k."execution_id" = NEW."execution_id")
          OR (k."scope" = 'attempt' AND k."attempt_id" = NEW."attempt_id")
        )
      ) THEN
        RAISE EXCEPTION 'provider submit is blocked by an active kill switch' USING ERRCODE = '55000';
      END IF;
      UPDATE "foundry_attempts"
      SET "state" = 'submit_pending',
          "revision" = "revision" + 1,
          "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 microsecond')
      WHERE "id" = NEW."attempt_id" AND "fencing_token" = NEW."fencing_token";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider submit lost its authorized attempt fence' USING ERRCODE = '40001';
      END IF;
      -- guard_foundry_attempt_projection is the single writer for the matching
      -- execution state/revision projection. A second UPDATE here observes the
      -- already-cascaded submit_pending state and rolls back every submit.
    ELSIF NEW."command_kind" = 'provider_checkpoint' THEN
      IF attempt_state <> 'running'
         OR attempt_cancel_requested THEN
        RAISE EXCEPTION 'provider checkpoint cannot be queued during containment or outside live execution'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NEW."command_kind" = 'provider_stop' THEN
      IF attempt_state NOT IN ('stop_pending', 'termination_unconfirmed')
         OR NOT attempt_cancel_requested
         OR attempt_provider_execution_ref IS NULL THEN
        RAISE EXCEPTION 'provider stop requires a live provider-bound containment projection and stop intent'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF attempt_state NOT IN (
        'provider_unknown', 'queued', 'running', 'checkpointing', 'stop_pending',
        'terminating', 'termination_unconfirmed', 'validating'
      ) THEN
        RAISE EXCEPTION 'provider observation command requires a provider-bound attempt' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  command_now := clock_timestamp();
  IF OLD."state" = 'pending' AND NEW."state" = 'claimed' THEN
    NEW."claimed_at" := GREATEST(command_now, OLD."updated_at" + interval '1 microsecond');
    NEW."updated_at" := NEW."claimed_at";
  ELSIF OLD."state" = 'claimed'
        AND NEW."state" IN ('succeeded', 'failed', 'uncertain') THEN
    NEW."completed_at" := GREATEST(command_now, OLD."updated_at" + interval '1 microsecond');
    NEW."updated_at" := NEW."completed_at";
  ELSIF OLD."state" = 'pending' AND NEW."state" = 'cancelled' THEN
    NEW."completed_at" := GREATEST(command_now, OLD."updated_at" + interval '1 microsecond');
    NEW."updated_at" := NEW."completed_at";
  ELSIF OLD."state" = 'claimed' AND NEW."state" = 'pending' THEN
    NEW."updated_at" := GREATEST(command_now, OLD."updated_at" + interval '1 microsecond');
  END IF;
  SELECT e."rights_policy_version" INTO rights_policy_version
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'provider command execution scope is absent' USING ERRCODE = '23503';
  END IF;
  PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  IF OLD."state" = 'claimed' THEN
    SELECT EXISTS (
      SELECT 1
      FROM "foundry_execution_events" invocation
      WHERE invocation."provider_command_id" = OLD."id"
        AND invocation."claim_token" = OLD."claim_token"
        AND invocation."event_kind" = 'provider_invocation_started'
    ) INTO claim_invocation_exists;
  END IF;

  IF ROW(
    NEW."execution_id", NEW."project_id", NEW."job_id", NEW."execution_envelope_sha256",
    NEW."execution_subject_sha256",
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."attempt_id", NEW."attempt_ordinal", NEW."fencing_token", NEW."command_sequence",
    NEW."command_kind", NEW."prepared_provider_request_id", NEW."stop_intent_id",
    NEW."payload", NEW."payload_sha256", NEW."provider_request_sha256",
    NEW."provider_request_profile_id", NEW."provider_request_profile_version",
    NEW."provider_request_profile_sha256", NEW."provider_adapter_configuration_sha256",
    NEW."provider_idempotency_key",
    NEW."provider_client_request_id", NEW."stage_ids", NEW."maximum_api_call_seconds",
    NEW."target_provider_ref", NEW."originating_submit_command_id",
    NEW."originating_submit_provider_request_sha256",
    NEW."originating_submit_provider_idempotency_key", NEW."available_at",
    NEW."created_by_actor_kind", NEW."created_by_actor_key", NEW."created_by_user_id",
    NEW."idempotency_key", NEW."causation_id", NEW."correlation_id",
    NEW."request_digest", NEW."created_at"
  ) IS DISTINCT FROM ROW(
    OLD."execution_id", OLD."project_id", OLD."job_id", OLD."execution_envelope_sha256",
    OLD."execution_subject_sha256",
    OLD."provider_kind", OLD."provider_adapter_id", OLD."provider_adapter_version",
    OLD."provider_adapter_artifact_sha256", OLD."provider_deployment_sha256",
    OLD."attempt_id", OLD."attempt_ordinal", OLD."fencing_token", OLD."command_sequence",
    OLD."command_kind", OLD."prepared_provider_request_id", OLD."stop_intent_id",
    OLD."payload", OLD."payload_sha256", OLD."provider_request_sha256",
    OLD."provider_request_profile_id", OLD."provider_request_profile_version",
    OLD."provider_request_profile_sha256", OLD."provider_adapter_configuration_sha256",
    OLD."provider_idempotency_key",
    OLD."provider_client_request_id", OLD."stage_ids", OLD."maximum_api_call_seconds",
    OLD."target_provider_ref", OLD."originating_submit_command_id",
    OLD."originating_submit_provider_request_sha256",
    OLD."originating_submit_provider_idempotency_key", OLD."available_at",
    OLD."created_by_actor_kind", OLD."created_by_actor_key", OLD."created_by_user_id",
    OLD."idempotency_key", OLD."causation_id", OLD."correlation_id",
    OLD."request_digest", OLD."created_at"
  ) THEN
    RAISE EXCEPTION 'provider command identity, fence, and payload are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."revision" <> OLD."revision" + 1 OR NEW."updated_at" <= OLD."updated_at" THEN
    RAISE EXCEPTION 'provider command update requires the next revision and a later timestamp' USING ERRCODE = '40001';
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
     AND ROW(NEW."claimed_by", NEW."claim_token", NEW."claimed_at", NEW."claim_expires_at")
       IS DISTINCT FROM
       ROW(OLD."claimed_by", OLD."claim_token", OLD."claimed_at", OLD."claim_expires_at") THEN
    RAISE EXCEPTION 'provider command completion cannot replace its live claim identity'
      USING ERRCODE = '40001';
  END IF;
  IF ROW(NEW."completed_by_actor_kind", NEW."completed_by_actor_key")
       IS DISTINCT FROM
       ROW(OLD."completed_by_actor_kind", OLD."completed_by_actor_key")
     AND NOT (
       OLD."state" = 'claimed'
       AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
       AND OLD."completed_by_actor_kind" IS NULL
       AND OLD."completed_by_actor_key" IS NULL
       AND NEW."completed_by_actor_kind" IS NOT NULL
       AND NEW."completed_by_actor_key" IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'provider command completion actor may be set only by its exact terminal transition'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'claimed'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
     AND (
       (
         NEW."completed_at" < OLD."claim_expires_at"
         AND (
           NEW."completed_by_actor_kind" <> 'service'
           OR NEW."completed_by_actor_key" IS DISTINCT FROM OLD."claimed_by"
         )
       )
       OR (
         NEW."completed_at" >= OLD."claim_expires_at"
         AND NEW."completed_by_actor_kind" NOT IN ('watchdog', 'system')
       )
     ) THEN
    RAISE EXCEPTION 'provider command completion actor does not match live-worker or expired-lease custody'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'claimed'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
     AND (
       jsonb_typeof(NEW."outcome_json") IS DISTINCT FROM 'object'
       OR NEW."outcome_sha256" IS DISTINCT FROM "foundry_domain_jsonb_sha256"(
         'omnitwin.foundry.provider-command-outcome.v0', NEW."outcome_json"
       )
     ) THEN
    RAISE EXCEPTION 'provider command outcome digest must bind its exact canonical JSON'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."provider_command_ref" IS DISTINCT FROM OLD."provider_command_ref" AND NOT (
       OLD."state" = 'claimed'
       AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
       AND OLD."provider_command_ref" IS NULL
       AND NEW."provider_command_ref" IS NOT DISTINCT FROM NEW."outcome_json"->>'providerCommandRef'
     ) THEN
    RAISE EXCEPTION 'provider command reference may be set only by its exact terminal outcome'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."cancelled_by_stop_intent_id" IS DISTINCT FROM OLD."cancelled_by_stop_intent_id" AND NOT (
       OLD."state" = 'pending'
       AND NEW."state" = 'cancelled'
       AND OLD."cancelled_by_stop_intent_id" IS NULL
       AND NEW."cancelled_by_stop_intent_id" IS NOT NULL
       AND pg_trigger_depth() >= 2
       AND NOT EXISTS (
         SELECT 1
         FROM "foundry_execution_events" invocation
         WHERE invocation."provider_command_id" = OLD."id"
           AND invocation."event_kind" = 'provider_invocation_started'
       )
       AND EXISTS (
         SELECT 1
         FROM "foundry_stop_intents" s
         JOIN "foundry_attempts" a ON a."id" = s."attempt_id"
         WHERE s."id" = NEW."cancelled_by_stop_intent_id"
           AND s."attempt_id" = OLD."attempt_id"
           AND s."fencing_token" = OLD."fencing_token"
           AND a."cancel_requested"
           AND (
             left(a."state", 9) = 'terminal_'
             OR OLD."command_kind" = 'provider_checkpoint'
             OR (
               OLD."command_kind" = 'provider_reconcile'
               AND a."provider_execution_ref" IS NOT NULL
             )
           )
       )
     ) THEN
    RAISE EXCEPTION 'pending provider command cancellation requires its exact applied stop intent'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."cancelled_by_provider_command_id" IS DISTINCT FROM OLD."cancelled_by_provider_command_id" AND NOT (
       OLD."state" = 'pending'
       AND NEW."state" = 'cancelled'
       AND OLD."cancelled_by_provider_command_id" IS NULL
       AND NEW."cancelled_by_provider_command_id" IS NOT NULL
       AND pg_trigger_depth() >= 2
       AND NOT EXISTS (
         SELECT 1
         FROM "foundry_execution_events" invocation
         WHERE invocation."provider_command_id" = OLD."id"
           AND invocation."event_kind" = 'provider_invocation_started'
       )
       AND EXISTS (
         SELECT 1
         FROM "foundry_provider_commands" source_command
         JOIN "foundry_attempts" a ON a."id" = source_command."attempt_id"
         WHERE source_command."id" = NEW."cancelled_by_provider_command_id"
           AND source_command."id" <> OLD."id"
           AND source_command."attempt_id" = OLD."attempt_id"
           AND source_command."fencing_token" = OLD."fencing_token"
           AND source_command."state" = 'claimed'
           AND left(a."state", 9) = 'terminal_'
       )
     ) THEN
    RAISE EXCEPTION 'pending provider command cancellation requires its exact terminalizing provider command'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."state" IN ('succeeded', 'failed', 'uncertain', 'cancelled') THEN
    RAISE EXCEPTION 'terminal provider command is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" = 'pending'
     AND OLD."command_kind" = 'provider_submit' THEN
    RAISE EXCEPTION 'claimed provider submit can never be made pending or resubmitted' USING ERRCODE = '55000';
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" = 'pending'
     AND claim_invocation_exists THEN
    RAISE EXCEPTION 'an invoked provider command cannot be reclaimed in place; it requires uncertain closure'
      USING ERRCODE = '55000';
  END IF;
  IF OLD."state" = 'claimed' AND clock_timestamp() >= OLD."claim_expires_at"
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
     AND (
       (claim_invocation_exists AND NEW."state" <> 'uncertain')
       OR (NOT claim_invocation_exists AND NEW."state" <> 'failed')
     ) THEN
    RAISE EXCEPTION 'expired provider claim must close as invoked-uncertain or uninvoked-failed'
      USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD."state" = 'pending' AND NEW."state" = 'claimed')
    OR (OLD."state" = 'pending' AND NEW."state" = 'cancelled')
    OR (OLD."state" = 'claimed' AND NEW."state" IN ('pending', 'succeeded', 'failed', 'uncertain'))
  ) THEN
    RAISE EXCEPTION 'illegal provider command transition: % -> %', OLD."state", NEW."state" USING ERRCODE = '23514';
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" = 'pending'
     AND OLD."claim_expires_at" > command_now THEN
    RAISE EXCEPTION 'claimed command cannot be reclaimed before lease expiry' USING ERRCODE = '55000';
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" = 'pending'
     AND NOT claim_invocation_exists
     AND OLD."command_kind" IN ('provider_checkpoint', 'provider_stop') THEN
    UPDATE "foundry_attempts" AS target_attempt
    SET "state" = CASE OLD."command_kind"
          WHEN 'provider_checkpoint' THEN 'running'
          ELSE 'termination_unconfirmed'
        END,
        "revision" = target_attempt."revision" + 1,
        "updated_at" = GREATEST(
          command_now, target_attempt."updated_at" + interval '1 microsecond'
        )
    WHERE target_attempt."id" = OLD."attempt_id"
      AND target_attempt."fencing_token" = OLD."fencing_token"
      AND (
        (OLD."command_kind" = 'provider_checkpoint'
          AND target_attempt."state" = 'checkpointing'
          AND NOT target_attempt."cancel_requested")
        OR
        (OLD."command_kind" = 'provider_stop'
          AND target_attempt."state" = 'terminating'
          AND target_attempt."cancel_requested")
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'expired uninvoked command cannot restore its exact pre-invocation projection'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" = 'claimed' AND NEW."state" IN ('succeeded', 'failed', 'uncertain') AND (
       NEW."completed_at" IS DISTINCT FROM NEW."updated_at"
       OR (
         NEW."completed_at" > OLD."claim_expires_at"
         AND NOT (
           clock_timestamp() >= OLD."claim_expires_at"
           AND (
             (claim_invocation_exists AND NEW."state" = 'uncertain')
             OR (NOT claim_invocation_exists AND NEW."state" = 'failed')
           )
         )
       )
     ) THEN
    RAISE EXCEPTION 'provider command completion must use the database clock within its live claim lease'
      USING ERRCODE = '40001';
  END IF;
  IF OLD."state" = 'claimed' AND OLD."command_kind" = 'provider_submit'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain') THEN
    SELECT a."state", a."cancel_requested", winning_intent."target_terminal_state"
    INTO attempt_state, attempt_cancel_requested, stop_terminal_state
    FROM "foundry_attempts" a
    LEFT JOIN LATERAL (
      SELECT s."target_terminal_state"
      FROM "foundry_stop_intents" s
      WHERE s."attempt_id" = a."id"
        AND s."fencing_token" = a."fencing_token"
      ORDER BY s."priority" DESC, s."recorded_at" ASC, s."id" ASC
      LIMIT 1
    ) winning_intent ON true
    WHERE a."id" = NEW."attempt_id"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF a;
    IF NOT FOUND OR (attempt_cancel_requested AND stop_terminal_state IS NULL) THEN
      RAISE EXCEPTION 'provider submit completion lost its fenced containment projection'
        USING ERRCODE = '40001';
    END IF;
    IF left(attempt_state, 9) = 'terminal_' THEN
      IF NEW."state" <> 'failed'
         OR NEW."provider_lifecycle_state" <> 'not_observed'
         OR NOT attempt_cancel_requested THEN
        RAISE EXCEPTION 'terminal pre-invocation cancellation can record only a not-observed submit failure'
          USING ERRCODE = '40001';
      END IF;
    ELSE
      UPDATE "foundry_attempts" AS target_attempt
      SET "state" = CASE NEW."state"
            WHEN 'succeeded' THEN CASE
              WHEN attempt_cancel_requested THEN 'stop_pending'
              WHEN NEW."provider_lifecycle_state" = 'running' THEN 'running'
              ELSE 'queued'
            END
            WHEN 'failed' THEN CASE
              WHEN attempt_cancel_requested THEN stop_terminal_state
              ELSE 'terminal_failed'
            END
            ELSE CASE
              WHEN attempt_cancel_requested THEN 'stop_pending'
              ELSE 'provider_unknown'
            END
          END,
          "provider_execution_ref" = CASE
            WHEN NEW."state" = 'succeeded' THEN NEW."provider_command_ref"
            ELSE target_attempt."provider_execution_ref"
          END,
          "submitted_at" = CASE
            WHEN NEW."state" = 'succeeded' THEN NEW."completed_at"
            ELSE target_attempt."submitted_at"
          END,
          "started_at" = CASE
            WHEN NEW."state" = 'succeeded'
              AND NEW."provider_lifecycle_state" = 'running'
              THEN COALESCE(target_attempt."started_at", NEW."completed_at")
            ELSE target_attempt."started_at"
          END,
          "wall_clock_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(secs => execution."max_wall_clock_seconds")
            ELSE target_attempt."wall_clock_deadline" END,
          "cancel_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(
              secs => execution."max_wall_clock_seconds" + execution."cancel_grace_seconds"
            ) ELSE target_attempt."cancel_deadline" END,
          "termination_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(
              secs => execution."max_wall_clock_seconds" + execution."cancel_grace_seconds"
                + execution."termination_grace_seconds"
            ) ELSE target_attempt."termination_deadline" END,
          "worker_self_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(secs => execution."worker_self_deadline_seconds")
            ELSE target_attempt."worker_self_deadline" END,
          "termination_confirmation_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(
              secs => execution."worker_self_deadline_seconds"
                + execution."termination_confirmation_timeout_seconds"
            ) ELSE target_attempt."termination_confirmation_deadline" END,
          "provider_ttl_deadline" = CASE WHEN NEW."state" = 'succeeded'
            THEN NEW."completed_at" + make_interval(
              secs => execution."provider_maximum_execution_ttl_seconds"
            ) ELSE target_attempt."provider_ttl_deadline" END,
          "finished_at" = CASE
            WHEN NEW."state" = 'failed' THEN NEW."completed_at"
            ELSE target_attempt."finished_at"
          END,
          "revision" = target_attempt."revision" + 1,
          "updated_at" = GREATEST(
            NEW."updated_at", target_attempt."updated_at" + interval '1 microsecond'
          )
      FROM "foundry_executions" execution
      WHERE target_attempt."id" = NEW."attempt_id"
        AND target_attempt."execution_id" = execution."id"
        AND target_attempt."fencing_token" = NEW."fencing_token"
        AND target_attempt."state" IN ('submit_pending', 'stop_pending');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider submit completion requires its fenced submit or containment projection'
          USING ERRCODE = '40001';
      END IF;
    END IF;
    -- guard_foundry_attempt_projection is the only execution-state writer.
  END IF;
  IF OLD."state" = 'claimed' AND OLD."command_kind" = 'provider_reconcile'
     AND NEW."state" = 'succeeded' THEN
    SELECT a."cancel_requested", winning_intent."target_terminal_state"
    INTO attempt_cancel_requested, stop_terminal_state
    FROM "foundry_attempts" a
    LEFT JOIN LATERAL (
      SELECT s."target_terminal_state"
      FROM "foundry_stop_intents" s
      WHERE s."attempt_id" = a."id"
        AND s."fencing_token" = a."fencing_token"
      ORDER BY s."priority" DESC, s."recorded_at" ASC, s."id" ASC
      LIMIT 1
    ) winning_intent ON true
    WHERE a."id" = NEW."attempt_id"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF a;
    IF NOT FOUND OR (attempt_cancel_requested AND stop_terminal_state IS NULL) THEN
      RAISE EXCEPTION 'provider reconcile completion lost its fenced containment projection'
        USING ERRCODE = '40001';
    END IF;
    UPDATE "foundry_attempts" AS target_attempt
    SET "state" = CASE NEW."provider_lifecycle_state"
          WHEN 'queued' THEN CASE
            WHEN attempt_cancel_requested THEN 'stop_pending'
            ELSE 'queued'
          END
          WHEN 'running' THEN CASE
            WHEN attempt_cancel_requested THEN 'stop_pending'
            ELSE 'running'
          END
          WHEN 'exited' THEN CASE
            WHEN attempt_cancel_requested THEN stop_terminal_state
            ELSE 'validating'
          END
          WHEN 'terminated' THEN CASE
            WHEN attempt_cancel_requested THEN stop_terminal_state
            ELSE 'terminal_provider_lost'
          END
          WHEN 'not_found' THEN CASE
            WHEN attempt_cancel_requested THEN stop_terminal_state
            ELSE 'terminal_provider_lost'
          END
          ELSE 'terminal_provider_lost'
        END,
        "provider_execution_ref" = COALESCE(
          target_attempt."provider_execution_ref", NEW."provider_command_ref"
        ),
        "submitted_at" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL
            THEN COALESCE(target_attempt."submitted_at", NEW."completed_at")
          ELSE target_attempt."submitted_at"
        END,
        "started_at" = CASE
          WHEN NEW."provider_lifecycle_state" = 'running'
            THEN COALESCE(target_attempt."started_at", NEW."completed_at")
          ELSE target_attempt."started_at"
        END,
        "wall_clock_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(secs => execution."max_wall_clock_seconds")
          ELSE target_attempt."wall_clock_deadline" END,
        "cancel_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(
              secs => execution."max_wall_clock_seconds" + execution."cancel_grace_seconds"
            ) ELSE target_attempt."cancel_deadline" END,
        "termination_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(
              secs => execution."max_wall_clock_seconds" + execution."cancel_grace_seconds"
                + execution."termination_grace_seconds"
            ) ELSE target_attempt."termination_deadline" END,
        "worker_self_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(secs => execution."worker_self_deadline_seconds")
          ELSE target_attempt."worker_self_deadline" END,
        "termination_confirmation_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(
              secs => execution."worker_self_deadline_seconds"
                + execution."termination_confirmation_timeout_seconds"
            ) ELSE target_attempt."termination_confirmation_deadline" END,
        "provider_ttl_deadline" = CASE
          WHEN NEW."provider_command_ref" IS NOT NULL AND target_attempt."submitted_at" IS NULL
            THEN NEW."completed_at" + make_interval(
              secs => execution."provider_maximum_execution_ttl_seconds"
            ) ELSE target_attempt."provider_ttl_deadline" END,
        "finished_at" = CASE
          WHEN (attempt_cancel_requested
            AND NEW."provider_lifecycle_state" IN ('exited', 'terminated', 'not_found'))
            OR NEW."provider_lifecycle_state" IN ('terminated', 'not_found')
            THEN NEW."completed_at"
          ELSE target_attempt."finished_at"
        END,
        "revision" = target_attempt."revision" + 1,
        "updated_at" = GREATEST(
          NEW."updated_at", target_attempt."updated_at" + interval '1 microsecond'
        )
    FROM "foundry_executions" execution
    WHERE target_attempt."id" = NEW."attempt_id"
      AND target_attempt."execution_id" = execution."id"
      AND target_attempt."fencing_token" = NEW."fencing_token"
      AND target_attempt."state" IN ('provider_unknown', 'stop_pending');
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM "foundry_attempts" terminal_attempt
      WHERE terminal_attempt."id" = NEW."attempt_id"
        AND terminal_attempt."fencing_token" = NEW."fencing_token"
        AND left(terminal_attempt."state", 9) = 'terminal_'
    ) THEN
      RAISE EXCEPTION 'provider reconcile completion requires its fenced unknown attempt'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" = 'claimed'
     AND OLD."command_kind" = 'provider_poll'
     AND (
       NEW."state" = 'succeeded'
       OR (NEW."state" = 'failed' AND NEW."provider_lifecycle_state" = 'not_found')
     ) THEN
    SELECT a."cancel_requested", winning_intent."target_terminal_state"
    INTO attempt_cancel_requested, stop_terminal_state
    FROM "foundry_attempts" a
    LEFT JOIN LATERAL (
      SELECT s."target_terminal_state"
      FROM "foundry_stop_intents" s
      WHERE s."attempt_id" = a."id"
        AND s."fencing_token" = a."fencing_token"
      ORDER BY s."priority" DESC, s."recorded_at" ASC, s."id" ASC
      LIMIT 1
    ) winning_intent ON true
    WHERE a."id" = NEW."attempt_id"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF a;
    IF NOT FOUND OR (attempt_cancel_requested AND stop_terminal_state IS NULL) THEN
      RAISE EXCEPTION 'provider observation completion lost its fenced containment projection'
        USING ERRCODE = '40001';
    END IF;
    UPDATE "foundry_attempts" AS target_attempt
    SET "state" = CASE
          WHEN target_attempt."cancel_requested"
               AND NEW."provider_lifecycle_state" IN ('exited', 'terminated', 'not_found')
            THEN stop_terminal_state
          WHEN target_attempt."cancel_requested" THEN target_attempt."state"
          WHEN NEW."provider_lifecycle_state" = 'queued' THEN
            CASE WHEN target_attempt."state" IN ('running', 'checkpointing', 'validating')
              THEN target_attempt."state" ELSE 'queued' END
          WHEN NEW."provider_lifecycle_state" = 'running' THEN
            CASE WHEN target_attempt."state" = 'validating' THEN 'validating' ELSE 'running' END
          WHEN NEW."provider_lifecycle_state" = 'exited' THEN 'validating'
          ELSE 'terminal_provider_lost'
        END,
        "started_at" = CASE
          WHEN NEW."provider_lifecycle_state" = 'running'
            THEN COALESCE(target_attempt."started_at", NEW."completed_at")
          ELSE target_attempt."started_at"
        END,
        "finished_at" = CASE
          WHEN (
            target_attempt."cancel_requested"
            AND NEW."provider_lifecycle_state" IN ('exited', 'terminated', 'not_found')
          ) OR NEW."provider_lifecycle_state" IN ('terminated', 'not_found')
            THEN NEW."completed_at"
          ELSE target_attempt."finished_at"
        END,
        "revision" = target_attempt."revision" + 1,
        "updated_at" = GREATEST(
          NEW."updated_at", target_attempt."updated_at" + interval '1 microsecond'
        )
    WHERE target_attempt."id" = NEW."attempt_id"
      AND target_attempt."fencing_token" = NEW."fencing_token"
      AND left(target_attempt."state", 9) <> 'terminal_';
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM "foundry_attempts" terminal_attempt
      WHERE terminal_attempt."id" = NEW."attempt_id"
        AND terminal_attempt."fencing_token" = NEW."fencing_token"
        AND left(terminal_attempt."state", 9) = 'terminal_'
    ) THEN
      RAISE EXCEPTION 'provider observation completion requires its live fenced attempt'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" = 'claimed'
     AND OLD."command_kind" = 'provider_checkpoint'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain') THEN
    SELECT a."cancel_requested", winning_intent."target_terminal_state"
    INTO attempt_cancel_requested, stop_terminal_state
    FROM "foundry_attempts" a
    LEFT JOIN LATERAL (
      SELECT s."target_terminal_state"
      FROM "foundry_stop_intents" s
      WHERE s."attempt_id" = a."id"
        AND s."fencing_token" = a."fencing_token"
      ORDER BY s."priority" DESC, s."recorded_at" ASC, s."id" ASC
      LIMIT 1
    ) winning_intent ON true
    WHERE a."id" = NEW."attempt_id"
      AND a."fencing_token" = NEW."fencing_token"
    FOR UPDATE OF a;
    IF NOT FOUND OR (attempt_cancel_requested AND stop_terminal_state IS NULL) THEN
      RAISE EXCEPTION 'provider checkpoint completion lost its fenced containment projection'
        USING ERRCODE = '40001';
    END IF;
    UPDATE "foundry_attempts" AS target_attempt
    SET "state" = CASE
          WHEN target_attempt."cancel_requested"
               AND NEW."provider_lifecycle_state" IN ('exited', 'terminated', 'not_found')
            THEN stop_terminal_state
          WHEN target_attempt."cancel_requested" THEN target_attempt."state"
          WHEN NEW."state" = 'succeeded'
               AND NEW."provider_lifecycle_state" = 'exited' THEN 'validating'
          WHEN (
            NEW."state" = 'succeeded'
            AND NEW."provider_lifecycle_state" = 'terminated'
          ) OR (
            NEW."state" = 'failed'
            AND NEW."provider_lifecycle_state" = 'not_found'
          ) THEN 'terminal_provider_lost'
          ELSE 'running'
        END,
        "finished_at" = CASE
          WHEN (
            target_attempt."cancel_requested"
            AND NEW."provider_lifecycle_state" IN ('exited', 'terminated', 'not_found')
          ) OR (
            NEW."state" = 'succeeded'
            AND NEW."provider_lifecycle_state" = 'terminated'
          ) OR (
            NEW."state" = 'failed'
            AND NEW."provider_lifecycle_state" = 'not_found'
          ) THEN NEW."completed_at"
          ELSE target_attempt."finished_at"
        END,
        "revision" = target_attempt."revision" + 1,
        "updated_at" = GREATEST(
          NEW."updated_at", target_attempt."updated_at" + interval '1 microsecond'
        )
    WHERE target_attempt."id" = NEW."attempt_id"
      AND target_attempt."fencing_token" = NEW."fencing_token"
      AND left(target_attempt."state", 9) <> 'terminal_';
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM "foundry_attempts" terminal_attempt
      WHERE terminal_attempt."id" = NEW."attempt_id"
        AND terminal_attempt."fencing_token" = NEW."fencing_token"
        AND left(terminal_attempt."state", 9) = 'terminal_'
    ) THEN
      RAISE EXCEPTION 'provider checkpoint completion requires its live fenced attempt'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" = 'claimed' AND OLD."command_kind" = 'provider_stop'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain') THEN
    SELECT s."target_terminal_state"
    INTO stop_terminal_state
    FROM "foundry_stop_intents" s
    WHERE s."attempt_id" = NEW."attempt_id"
      AND s."fencing_token" = NEW."fencing_token"
    ORDER BY s."priority" DESC, s."recorded_at" ASC, s."id" ASC
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'provider stop completion lost its immutable stop intent'
        USING ERRCODE = '40001';
    END IF;
    UPDATE "foundry_attempts" AS target_attempt
    SET "state" = CASE
          WHEN NEW."state" = 'succeeded'
            OR NEW."provider_lifecycle_state" = 'not_found' THEN stop_terminal_state
          ELSE 'termination_unconfirmed'
        END,
        "cancel_requested" = true,
        "finished_at" = CASE
          WHEN NEW."state" = 'succeeded'
            OR NEW."provider_lifecycle_state" = 'not_found' THEN NEW."completed_at"
          ELSE target_attempt."finished_at"
        END,
        "revision" = target_attempt."revision" + 1,
        "updated_at" = GREATEST(
          NEW."updated_at", target_attempt."updated_at" + interval '1 microsecond'
        )
    WHERE target_attempt."id" = NEW."attempt_id"
      AND target_attempt."fencing_token" = NEW."fencing_token"
      AND target_attempt."state" IN ('stop_pending', 'terminating', 'termination_unconfirmed');
    IF NOT FOUND AND NOT EXISTS (
      SELECT 1 FROM "foundry_attempts" terminal_attempt
      WHERE terminal_attempt."id" = NEW."attempt_id"
        AND terminal_attempt."fencing_token" = NEW."fencing_token"
        AND left(terminal_attempt."state", 9) = 'terminal_'
    ) THEN
      RAISE EXCEPTION 'provider stop completion requires its live containment attempt'
        USING ERRCODE = '40001';
    END IF;
  END IF;
  IF OLD."state" = 'claimed'
     AND NEW."state" IN ('succeeded', 'failed', 'uncertain')
     AND EXISTS (
       SELECT 1 FROM "foundry_attempts" terminal_attempt
       WHERE terminal_attempt."id" = NEW."attempt_id"
         AND terminal_attempt."fencing_token" = NEW."fencing_token"
         AND left(terminal_attempt."state", 9) = 'terminal_'
     ) THEN
    WITH cancellable AS (
      SELECT pending_command."id"
      FROM "foundry_provider_commands" pending_command
      WHERE pending_command."attempt_id" = NEW."attempt_id"
        AND pending_command."fencing_token" = NEW."fencing_token"
        AND pending_command."id" <> NEW."id"
        AND pending_command."state" = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM "foundry_execution_events" invocation
          WHERE invocation."provider_command_id" = pending_command."id"
            AND invocation."event_kind" = 'provider_invocation_started'
        )
      FOR UPDATE OF pending_command SKIP LOCKED
    )
    UPDATE "foundry_provider_commands" pending_command
    SET "state" = 'cancelled',
        "cancelled_by_provider_command_id" = NEW."id",
        "revision" = pending_command."revision" + 1,
        "updated_at" = GREATEST(
          clock_timestamp(), pending_command."updated_at" + interval '1 microsecond'
        )
    FROM cancellable
    WHERE pending_command."id" = cancellable."id";
  END IF;
  IF OLD."state" = 'pending' AND NEW."state" = 'claimed' THEN
    SELECT e."fencing_token", e."total_cost_micro_usd", e."cost_hard_stop_micro_usd",
           e."termination_reserve_micro_usd", e."absolute_cost_cap_micro_usd", e."dispatch_deadline",
           e."rights_policy_version", e."rights_policy_definition_sha256", e."rights_policy_generation",
           p."lease_ttl_seconds", a."state", e."state", a."cancel_requested", e."cancel_requested",
           a."provider_execution_ref"
    INTO exec_fence, exec_total, exec_hard_stop, exec_reserve, exec_absolute, exec_deadline,
         rights_policy_version, rights_policy_definition_sha256, rights_policy_generation,
          exec_lease_ttl_seconds, attempt_state, exec_state,
          attempt_cancel_requested, exec_cancel_requested, attempt_provider_execution_ref
    FROM "foundry_executions" e
    JOIN "foundry_attempts" a
      ON a."id" = NEW."attempt_id"
     AND a."execution_id" = e."id"
     AND a."fencing_token" = NEW."fencing_token"
    JOIN "foundry_execution_policies" p
      ON p."execution_policy_sha256" = e."execution_policy_sha256"
    WHERE e."id" = NEW."execution_id"
    FOR UPDATE OF a, e;
    IF NEW."claimed_at" IS DISTINCT FROM NEW."updated_at"
       OR NEW."claim_expires_at" > NEW."claimed_at" + make_interval(secs => exec_lease_ttl_seconds)
       OR NEW."claimed_at" + make_interval(secs => NEW."maximum_api_call_seconds" + 1)
            > NEW."claim_expires_at"
       OR (NEW."command_kind" = 'provider_submit' AND NEW."claim_expires_at" > exec_deadline) THEN
      RAISE EXCEPTION 'provider command claim timestamps exceed the database-clock policy lease' USING ERRCODE = '23514';
    END IF;
    IF NEW."fencing_token" <> exec_fence THEN
      RAISE EXCEPTION 'stale provider command fence' USING ERRCODE = '40001';
    END IF;
    IF NEW."command_kind" = 'provider_submit' AND (
      attempt_state <> 'submit_pending' OR exec_state <> 'submit_pending'
      OR attempt_cancel_requested OR exec_cancel_requested
      OR clock_timestamp() >= exec_deadline OR exec_total >= exec_hard_stop
      OR exec_total + exec_reserve > exec_absolute
      OR NOT "foundry_rights_policy_is_active"(
        rights_policy_version, rights_policy_definition_sha256,
        rights_policy_generation,
        NEW."claimed_at" + make_interval(
          secs => NEW."maximum_api_call_seconds" + 1
        )
      )
      OR NOT "foundry_execution_authority_is_current"(
        NEW."execution_id",
        NEW."claimed_at" + make_interval(
          secs => NEW."maximum_api_call_seconds" + 1
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM "foundry_provider_request_profiles" request_profile
        WHERE request_profile."provider_request_profile_sha256" =
                NEW."provider_request_profile_sha256"
          AND request_profile."profile_id" = NEW."provider_request_profile_id"
          AND request_profile."profile_version" = NEW."provider_request_profile_version"
          AND request_profile."provider_kind" = NEW."provider_kind"
          AND request_profile."provider_adapter_id" = NEW."provider_adapter_id"
          AND request_profile."provider_adapter_version" = NEW."provider_adapter_version"
          AND request_profile."provider_adapter_artifact_sha256" =
                NEW."provider_adapter_artifact_sha256"
          AND request_profile."provider_adapter_configuration_sha256" =
                NEW."provider_adapter_configuration_sha256"
          AND request_profile."provider_deployment_sha256" =
                NEW."provider_deployment_sha256"
          AND request_profile."reviewed_at" <= NEW."claimed_at"
          AND request_profile."expires_at" > NEW."claimed_at" + make_interval(
                secs => NEW."maximum_api_call_seconds" + 1
              )
      )
      OR EXISTS (
        SELECT 1 FROM "foundry_kill_switches" k
        WHERE k."state" = 'active' AND (
          k."scope" = 'global'
          OR (k."scope" = 'provider' AND k."provider_kind" = NEW."provider_kind"
            AND k."provider_adapter_id" = NEW."provider_adapter_id"
            AND k."provider_adapter_version" = NEW."provider_adapter_version")
          OR (k."scope" = 'project' AND k."project_id" = NEW."project_id")
          OR (k."scope" = 'execution' AND k."execution_id" = NEW."execution_id")
          OR (k."scope" = 'attempt' AND k."attempt_id" = NEW."attempt_id")
        )
      )
    ) THEN
      RAISE EXCEPTION 'provider submit claim is blocked by state, cancellation, authority, deadline, cost, or kill switch' USING ERRCODE = '55000';
    ELSIF NEW."command_kind" = 'provider_reconcile' AND (
      attempt_state NOT IN ('provider_unknown', 'stop_pending')
      OR left(exec_state, 9) = 'terminal_'
    ) THEN
      RAISE EXCEPTION 'provider reconcile claim lost its unresolved live attempt'
        USING ERRCODE = '55000';
    ELSIF NEW."command_kind" = 'provider_poll' AND (
      left(attempt_state, 9) = 'terminal_'
      OR left(exec_state, 9) = 'terminal_'
      OR attempt_provider_execution_ref IS NULL
    ) THEN
      RAISE EXCEPTION 'provider observation claim lost its live provider resource'
        USING ERRCODE = '55000';
    ELSIF NEW."command_kind" = 'provider_checkpoint' AND (
      attempt_state <> 'running'
      OR left(exec_state, 9) = 'terminal_'
      OR attempt_cancel_requested
      OR attempt_provider_execution_ref IS NULL
      OR NOT "foundry_rights_policy_is_active"(
        rights_policy_version, rights_policy_definition_sha256,
        rights_policy_generation,
        NEW."claimed_at" + make_interval(
          secs => NEW."maximum_api_call_seconds" + 1
        )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM "foundry_executions" checkpoint_execution
        JOIN "foundry_rights_approvals" rights_approval
          ON rights_approval."id" = checkpoint_execution."rights_approval_id"
         AND rights_approval."rights_approval_sha256" =
               checkpoint_execution."rights_approval_sha256"
        WHERE checkpoint_execution."id" = NEW."execution_id"
          AND rights_approval."expires_at" > NEW."claimed_at" + make_interval(
                secs => NEW."maximum_api_call_seconds" + 1
              )
      )
      OR NOT EXISTS (
        SELECT 1
        FROM "foundry_provider_request_profiles" request_profile
        WHERE request_profile."provider_request_profile_sha256" =
                NEW."provider_request_profile_sha256"
          AND request_profile."profile_id" = NEW."provider_request_profile_id"
          AND request_profile."profile_version" = NEW."provider_request_profile_version"
          AND request_profile."provider_kind" = NEW."provider_kind"
          AND request_profile."provider_adapter_id" = NEW."provider_adapter_id"
          AND request_profile."provider_adapter_version" = NEW."provider_adapter_version"
          AND request_profile."provider_adapter_artifact_sha256" =
                NEW."provider_adapter_artifact_sha256"
          AND request_profile."provider_adapter_configuration_sha256" =
                NEW."provider_adapter_configuration_sha256"
          AND request_profile."provider_deployment_sha256" =
                NEW."provider_deployment_sha256"
          AND request_profile."reviewed_at" <= NEW."claimed_at"
          AND request_profile."expires_at" > NEW."claimed_at" + make_interval(
                secs => NEW."maximum_api_call_seconds" + 1
              )
      )
    ) THEN
      RAISE EXCEPTION 'provider checkpoint claim is blocked by containment, non-running state, rights, or profile expiry'
        USING ERRCODE = '55000';
    ELSIF NEW."command_kind" = 'provider_stop' AND (
      attempt_state NOT IN ('stop_pending', 'termination_unconfirmed')
      OR left(exec_state, 9) = 'terminal_'
      OR NOT attempt_cancel_requested
      OR attempt_provider_execution_ref IS NULL
    ) THEN
      RAISE EXCEPTION 'provider stop claim lost its live containment resource'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."command_kind" = 'provider_checkpoint' THEN
      UPDATE "foundry_attempts" AS target_attempt
      SET "state" = 'checkpointing',
          "revision" = target_attempt."revision" + 1,
          "updated_at" = GREATEST(
            clock_timestamp(), target_attempt."updated_at" + interval '1 microsecond'
          )
      WHERE target_attempt."id" = NEW."attempt_id"
        AND target_attempt."fencing_token" = NEW."fencing_token"
        AND target_attempt."state" = 'running'
        AND NOT target_attempt."cancel_requested";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider checkpoint claim lost its running fenced projection'
          USING ERRCODE = '40001';
      END IF;
    ELSIF NEW."command_kind" = 'provider_stop' THEN
      UPDATE "foundry_attempts" AS target_attempt
      SET "state" = 'terminating',
          "revision" = target_attempt."revision" + 1,
          "updated_at" = GREATEST(
            clock_timestamp(), target_attempt."updated_at" + interval '1 microsecond'
          )
      WHERE target_attempt."id" = NEW."attempt_id"
        AND target_attempt."fencing_token" = NEW."fencing_token"
        AND target_attempt."state" IN ('stop_pending', 'termination_unconfirmed')
        AND target_attempt."cancel_requested";
      IF NOT FOUND THEN
        RAISE EXCEPTION 'provider stop claim lost its live containment projection'
          USING ERRCODE = '40001';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "append_foundry_provider_command_transition_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  transition_kind varchar(30);
  transition_claim_token uuid;
  transition_actor_kind varchar(30);
  transition_actor_key varchar(160);
  transition_actor_user_id uuid;
  transition_recorded_at timestamptz;
  transition_advances_projection boolean;
  transition_payload jsonb;
  next_event_sequence bigint;
  prior_event_revision bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    transition_kind := 'enqueued';
    transition_claim_token := NULL;
    transition_actor_kind := NEW."created_by_actor_kind";
    transition_actor_key := NEW."created_by_actor_key";
    transition_actor_user_id := NEW."created_by_user_id";
    transition_recorded_at := NEW."created_at";
  ELSIF OLD."state" = 'pending' AND NEW."state" = 'claimed' THEN
    transition_kind := 'claimed';
    transition_claim_token := NEW."claim_token";
    transition_actor_kind := 'service';
    transition_actor_key := NEW."claimed_by";
    transition_actor_user_id := NULL;
    transition_recorded_at := NEW."claimed_at";
  ELSIF OLD."state" = 'claimed' AND NEW."state" = 'pending' THEN
    transition_kind := 'claim_released';
    transition_claim_token := OLD."claim_token";
    transition_actor_kind := 'system';
    transition_actor_key := 'system:provider-command-lease-recovery';
    transition_actor_user_id := NULL;
    transition_recorded_at := NEW."updated_at";
  ELSIF OLD."state" = 'pending' AND NEW."state" = 'cancelled' THEN
    transition_kind := 'cancelled';
    transition_claim_token := NULL;
    transition_actor_kind := 'system';
    transition_actor_key := 'system:provider-command-cancellation';
    transition_actor_user_id := NULL;
    transition_recorded_at := NEW."completed_at";
  ELSE
    RETURN NULL;
  END IF;

  transition_payload := jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.provider-command-transition.v0',
    'transitionKind', transition_kind,
    'commandId', NEW."id"::text,
    'commandRevision', NEW."revision",
    'commandState', NEW."state",
    'claimToken', to_jsonb(transition_claim_token::text),
    'cancelledByStopIntentId', to_jsonb(NEW."cancelled_by_stop_intent_id"::text),
    'cancelledByProviderCommandId',
      to_jsonb(NEW."cancelled_by_provider_command_id"::text)
  );
  SELECT COALESCE(max(event."sequence"), 0) + 1,
         COALESCE(max(event."resulting_revision"), 0)
  INTO next_event_sequence, prior_event_revision
  FROM "foundry_execution_events" event
  WHERE event."execution_id" = NEW."execution_id";
  transition_advances_projection :=
    (transition_kind = 'enqueued' AND NEW."command_kind" = 'provider_submit')
    OR (
      transition_kind IN ('claimed', 'claim_released')
      AND NEW."command_kind" IN ('provider_checkpoint', 'provider_stop')
    );

  INSERT INTO "foundry_execution_events" (
    "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "execution_subject_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
    "provider_command_id", "provider_command_kind", "claim_token",
    "provider_command_payload_sha256", "provider_request_sha256",
    "provider_idempotency_key", "maximum_api_call_seconds", "provider_command_state",
    "provider_command_outcome_sha256", "provider_lifecycle_state", "provider_was_invoked",
    "sequence", "event_kind", "advances_projection", "payload", "actor_kind",
    "actor_key", "actor_user_id", "idempotency_key", "causation_id",
    "correlation_id", "expected_revision", "resulting_revision", "request_digest",
    "recorded_at"
  ) VALUES (
    NEW."execution_id", NEW."project_id", NEW."job_id",
    NEW."execution_envelope_sha256", NEW."execution_subject_sha256",
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."attempt_id", NEW."attempt_ordinal", NEW."fencing_token", NEW."id",
    NEW."command_kind", transition_claim_token, NEW."payload_sha256",
    NEW."provider_request_sha256", NEW."provider_idempotency_key",
    NEW."maximum_api_call_seconds", NEW."state", NULL, NULL, NULL,
    next_event_sequence, 'provider_command_transitioned',
    transition_advances_projection, transition_payload, transition_actor_kind,
    transition_actor_key, transition_actor_user_id,
    'provider-command-transition:' || NEW."id"::text || ':' || NEW."revision"::text,
    NEW."id", NEW."correlation_id", prior_event_revision,
    prior_event_revision + CASE WHEN transition_advances_projection THEN 1 ELSE 0 END,
    "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.provider-command-transition.v0', transition_payload
    ),
    transition_recorded_at
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION "apply_foundry_cost_observation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  old_attempt_cost bigint;
  expected_sequence bigint;
  cost_delta bigint;
BEGIN
  NEW."recorded_at" := clock_timestamp();
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  SELECT a."observed_cost_micro_usd"
  INTO old_attempt_cost
  FROM "foundry_attempts" a
  JOIN "foundry_executions" e ON e."id" = a."execution_id"
  WHERE a."id" = NEW."attempt_id"
    AND a."execution_id" = NEW."execution_id"
    AND a."project_id" = NEW."project_id"
    AND a."job_id" = NEW."job_id"
    AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND a."provider_kind" = NEW."provider_kind"
    AND a."provider_adapter_id" = NEW."provider_adapter_id"
    AND a."provider_adapter_version" = NEW."provider_adapter_version"
    AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND a."attempt_ordinal" = NEW."attempt_ordinal"
    AND a."fencing_token" = NEW."fencing_token"
  FOR UPDATE OF a, e;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cost observation attempt scope is absent' USING ERRCODE = '23503';
  END IF;
  SELECT COALESCE(MAX(c."observation_sequence"), 0) + 1 INTO expected_sequence
  FROM "foundry_cost_observations" c WHERE c."attempt_id" = NEW."attempt_id";
  cost_delta := NEW."cumulative_cost_micro_usd" - old_attempt_cost;
  IF NEW."observation_sequence" <> expected_sequence
     OR cost_delta < 0
     OR NEW."incremental_cost_micro_usd" <> cost_delta THEN
    RAISE EXCEPTION 'cost observation sequence or cumulative delta is invalid' USING ERRCODE = '23514';
  END IF;
  IF cost_delta > 0 THEN
    UPDATE "foundry_attempts"
    SET "observed_cost_micro_usd" = NEW."cumulative_cost_micro_usd",
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."attempt_id";
    UPDATE "foundry_executions"
    SET "total_cost_micro_usd" = "total_cost_micro_usd" + cost_delta,
        "revision" = "revision" + 1,
        "updated_at" = GREATEST(clock_timestamp(), "updated_at" + interval '1 microsecond')
    WHERE "id" = NEW."execution_id";
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "append_foundry_cost_observation_application_event"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_payload jsonb;
  next_event_sequence bigint;
  prior_event_revision bigint;
  current_execution_revision bigint;
  projection_delta bigint;
  expected_projection_delta bigint;
BEGIN
  SELECT execution."revision" INTO STRICT current_execution_revision
  FROM "foundry_executions" execution
  WHERE execution."id" = NEW."execution_id";
  SELECT COALESCE(max(event."sequence"), 0) + 1,
         COALESCE(max(event."resulting_revision"), 0)
  INTO next_event_sequence, prior_event_revision
  FROM "foundry_execution_events" event
  WHERE event."execution_id" = NEW."execution_id";
  projection_delta := current_execution_revision - prior_event_revision;
  expected_projection_delta := CASE
    WHEN NEW."incremental_cost_micro_usd" > 0 THEN 1 ELSE 0 END;
  IF projection_delta IS DISTINCT FROM expected_projection_delta THEN
    RAISE EXCEPTION 'cost observation cannot close an unrelated execution projection revision'
      USING ERRCODE = '23514';
  END IF;
  SELECT jsonb_build_object(
    'schemaVersion', 'omnitwin.foundry.cost-observation-applied.v0',
    'costObservationId', NEW."id"::text,
    'observationSequence', NEW."observation_sequence"::text,
    'providerObservationId', NEW."provider_observation_id",
    'observationKind', NEW."observation_kind",
    'pricingCurrency', NEW."pricing_currency",
    'pricingSnapshotSha256', NEW."pricing_snapshot_sha256",
    'incrementalCostMicroUsd', NEW."incremental_cost_micro_usd"::text,
    'cumulativeCostMicroUsd', NEW."cumulative_cost_micro_usd"::text,
    'evidenceSha256', NEW."evidence_sha256",
    'providerObservedAt', to_char(
      NEW."provider_observed_at" AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"'
    ),
    'observationRequestDigest', NEW."request_digest",
    'resultingAttemptCostMicroUsd', attempt."observed_cost_micro_usd"::text,
    'resultingExecutionTotalMicroUsd', execution."total_cost_micro_usd"::text
  ) INTO STRICT event_payload
  FROM "foundry_attempts" attempt
  JOIN "foundry_executions" execution
    ON execution."id" = attempt."execution_id"
   AND execution."fencing_token" = attempt."fencing_token"
  WHERE attempt."id" = NEW."attempt_id"
    AND attempt."execution_id" = NEW."execution_id"
    AND attempt."fencing_token" = NEW."fencing_token";

  INSERT INTO "foundry_execution_events" (
    "execution_id", "project_id", "job_id", "execution_envelope_sha256",
    "execution_subject_sha256", "provider_kind", "provider_adapter_id",
    "provider_adapter_version", "provider_adapter_artifact_sha256",
    "provider_deployment_sha256", "attempt_id", "attempt_ordinal", "fencing_token",
    "sequence", "event_kind", "advances_projection", "payload", "actor_kind",
    "actor_key", "actor_user_id", "idempotency_key", "causation_id",
    "correlation_id", "expected_revision", "resulting_revision", "request_digest",
    "recorded_at"
  ) VALUES (
    NEW."execution_id", NEW."project_id", NEW."job_id",
    NEW."execution_envelope_sha256", (
      SELECT attempt."execution_subject_sha256"
      FROM "foundry_attempts" attempt
      WHERE attempt."id" = NEW."attempt_id"
    ), NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."provider_adapter_artifact_sha256", NEW."provider_deployment_sha256",
    NEW."attempt_id", NEW."attempt_ordinal", NEW."fencing_token",
    next_event_sequence, 'cost_observation_applied', projection_delta = 1, event_payload,
    'service', NEW."recorded_by", NULL,
    'cost-observation-applied:' || NEW."id"::text, NEW."id", NEW."correlation_id",
    prior_event_revision, prior_event_revision + projection_delta,
    "foundry_domain_jsonb_sha256"(
      'omnitwin.foundry.cost-observation-applied.v0', event_payload
    ), NEW."recorded_at"
  );
  RETURN NULL;
END;
$$;

CREATE FUNCTION "guard_foundry_uncertain_submit_reconciliation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."command_kind" = 'provider_submit' AND NEW."state" = 'uncertain'
     AND NOT EXISTS (
       SELECT 1
       FROM "foundry_provider_commands" r
       WHERE r."attempt_id" = NEW."attempt_id"
         AND r."execution_id" = NEW."execution_id"
         AND r."fencing_token" = NEW."fencing_token"
         AND r."command_kind" = 'provider_reconcile'
         AND r."state" IN ('pending', 'claimed')
         AND r."command_sequence" > NEW."command_sequence"
         AND r."causation_id" = NEW."id"
         AND r."correlation_id" = NEW."correlation_id"
     ) THEN
    RAISE EXCEPTION 'uncertain provider submit must enqueue a causally linked provider reconcile command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_prepared_provider_request_closure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "foundry_provider_commands" c
    WHERE c."id" = NEW."provider_command_id"
      AND c."prepared_provider_request_id" = NEW."id"
      AND c."execution_id" = NEW."execution_id"
      AND c."attempt_id" = NEW."attempt_id"
      AND c."execution_subject_sha256" = NEW."execution_subject_sha256"
      AND c."command_sequence" = NEW."command_sequence"
      AND c."command_kind" = NEW."command_kind"
      AND c."stop_intent_id" IS NOT DISTINCT FROM NEW."stop_intent_id"
      AND c."provider_request_sha256" = NEW."provider_request_sha256"
      AND c."provider_request_profile_id" = NEW."provider_request_profile_id"
      AND c."provider_request_profile_version" = NEW."provider_request_profile_version"
      AND c."provider_request_profile_sha256" = NEW."provider_request_profile_sha256"
      AND c."provider_adapter_configuration_sha256" =
            NEW."provider_adapter_configuration_sha256"
      AND c."provider_idempotency_key" = NEW."provider_idempotency_key"
      AND c."provider_client_request_id" = NEW."provider_client_request_id"
      AND c."stage_ids" = NEW."stage_ids"
      AND c."maximum_api_call_seconds" = NEW."maximum_api_call_seconds"
      AND c."created_by_actor_kind" = NEW."prepared_by_actor_kind"
      AND c."created_by_actor_key" = NEW."prepared_by_actor_key"
      AND c."created_by_user_id" IS NOT DISTINCT FROM NEW."prepared_by_user_id"
      AND c."payload"->'providerRequest' = NEW."provider_request_json"
      AND c."state" = 'pending'
      AND c."revision" = 0
      AND c."claimed_by" IS NULL
      AND c."claim_token" IS NULL
      AND c."claimed_at" IS NULL
      AND c."claim_expires_at" IS NULL
      AND c."outcome_json" IS NULL
      AND c."outcome_sha256" IS NULL
      AND c."provider_lifecycle_state" IS NULL
      AND c."provider_command_ref" IS NULL
      AND c."completed_at" IS NULL
      AND c."cancelled_by_stop_intent_id" IS NULL
      AND c."cancelled_by_provider_command_id" IS NULL
      AND c."created_at" = c."updated_at"
  ) THEN
    RAISE EXCEPTION 'prepared provider request must atomically close into one exact inert command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_provider_command_terminal_closure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."state" IN ('succeeded', 'failed', 'uncertain') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "foundry_execution_events" ev
      WHERE ev."provider_command_id" = NEW."id"
        AND ev."event_kind" = 'provider_command_completed'
        AND ev."execution_id" = NEW."execution_id"
        AND ev."attempt_id" = NEW."attempt_id"
        AND ev."fencing_token" = NEW."fencing_token"
        AND ev."provider_command_state" = NEW."state"
        AND ev."provider_command_outcome_sha256" = NEW."outcome_sha256"
        AND ev."provider_lifecycle_state" = NEW."provider_lifecycle_state"
        AND ev."payload" = NEW."outcome_json"
        AND ev."actor_kind" = NEW."completed_by_actor_kind"
        AND ev."actor_key" = NEW."completed_by_actor_key"
        AND ev."actor_user_id" IS NULL
        AND ev."idempotency_key" =
              'provider-command-completion:' || NEW."id"::text
        AND ev."causation_id" = NEW."id"
        AND ev."correlation_id" = NEW."correlation_id"
        AND ev."request_digest" = "foundry_domain_jsonb_sha256"(
              'omnitwin.foundry.provider-command-completed.v0', NEW."outcome_json"
            )
        AND ev."recorded_at" = NEW."completed_at"
    ) THEN
      RAISE EXCEPTION 'terminal provider command must close against one exact append-only completion event'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."command_kind" = 'provider_checkpoint'
       AND NEW."state" = 'succeeded'
       AND NOT EXISTS (
         SELECT 1
         FROM "foundry_verified_checkpoints" checkpoint
         WHERE checkpoint."provider_command_id" = NEW."id"
           AND checkpoint."execution_id" = NEW."execution_id"
           AND checkpoint."attempt_id" = NEW."attempt_id"
           AND checkpoint."attempt_ordinal" = NEW."attempt_ordinal"
           AND checkpoint."fencing_token" = NEW."fencing_token"
           AND checkpoint."provider_command_outcome_sha256" = NEW."outcome_sha256"
           AND NEW."completed_by_actor_kind" = 'service'
           AND checkpoint."verified_by" = NEW."completed_by_actor_key"
           AND NEW."outcome_json"->>'evidenceSha256' =
                 "foundry_verified_checkpoint_evidence_sha256"(
                   checkpoint."checkpoint_kind", checkpoint."provider_checkpoint_id",
                   checkpoint."checkpoint_sha256", checkpoint."evidence_ref",
                   checkpoint."provider_created_at"
                 )
           AND checkpoint."request_digest" =
                 "foundry_verified_checkpoint_request_digest"(checkpoint)
           AND checkpoint."causation_id" = NEW."id"
           AND checkpoint."correlation_id" = NEW."correlation_id"
       ) THEN
      RAISE EXCEPTION 'succeeded provider checkpoint must close against one exact verified checkpoint'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."command_kind" = 'provider_checkpoint'
       AND NEW."state" = 'uncertain'
       AND NOT (
         (
           EXISTS (
             SELECT 1
             FROM "foundry_stop_intents" containment_intent
             WHERE containment_intent."attempt_id" = NEW."attempt_id"
               AND containment_intent."fencing_token" = NEW."fencing_token"
               AND containment_intent."reason_code" = 'checkpoint_effect_unknown'
               AND containment_intent."source_kind" = 'provider_command'
               AND containment_intent."source_id" = NEW."id"
               AND containment_intent."source_digest" = NEW."outcome_sha256"
               AND containment_intent."causation_id" = NEW."id"
               AND containment_intent."correlation_id" = NEW."correlation_id"
           )
           AND EXISTS (
             SELECT 1
             FROM "foundry_provider_commands" successor
             JOIN "foundry_stop_intents" successor_intent
               ON successor_intent."id" = successor."stop_intent_id"
              AND successor_intent."attempt_id" = successor."attempt_id"
              AND successor_intent."fencing_token" = successor."fencing_token"
             WHERE successor."attempt_id" = NEW."attempt_id"
               AND successor."fencing_token" = NEW."fencing_token"
               AND successor."command_kind" = 'provider_stop'
               AND successor."state" IN ('pending', 'claimed')
               AND successor."command_sequence" > NEW."command_sequence"
               AND successor."target_provider_ref" = NEW."target_provider_ref"
           )
         )
         OR EXISTS (
           SELECT 1
           FROM "foundry_provider_commands" terminal_stop
           JOIN "foundry_execution_events" terminal_stop_event
             ON terminal_stop_event."provider_command_id" = terminal_stop."id"
            AND terminal_stop_event."event_kind" = 'provider_command_completed'
            AND terminal_stop_event."provider_command_state" = terminal_stop."state"
            AND terminal_stop_event."provider_command_outcome_sha256" =
                  terminal_stop."outcome_sha256"
            AND terminal_stop_event."payload" = terminal_stop."outcome_json"
           WHERE terminal_stop."attempt_id" = NEW."attempt_id"
             AND terminal_stop."fencing_token" = NEW."fencing_token"
             AND terminal_stop."command_kind" = 'provider_stop'
             AND terminal_stop."command_sequence" > NEW."command_sequence"
             AND terminal_stop."target_provider_ref" = NEW."target_provider_ref"
             AND (
               terminal_stop."state" = 'succeeded'
               OR (
                 terminal_stop."state" = 'failed'
                 AND terminal_stop."provider_lifecycle_state" = 'not_found'
               )
             )
             AND terminal_stop."provider_lifecycle_state" IN (
               'exited', 'terminated', 'not_found'
             )
         )
       ) THEN
      RAISE EXCEPTION 'uncertain provider checkpoint must atomically retain active stop custody'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."command_kind" = 'provider_reconcile'
       AND NEW."state" IN ('failed', 'uncertain')
       AND EXISTS (
         SELECT 1
         FROM "foundry_attempts" a
         WHERE a."id" = NEW."attempt_id"
           AND a."fencing_token" = NEW."fencing_token"
           AND a."provider_execution_ref" IS NULL
           AND a."state" IN ('provider_unknown', 'stop_pending')
       )
       AND NOT EXISTS (
         SELECT 1
         FROM "foundry_provider_commands" successor
         WHERE successor."attempt_id" = NEW."attempt_id"
           AND successor."fencing_token" = NEW."fencing_token"
           AND successor."command_kind" = 'provider_reconcile'
           AND successor."state" IN ('pending', 'claimed')
           AND successor."command_sequence" > NEW."command_sequence"
           AND successor."causation_id" = NEW."id"
           AND successor."correlation_id" = NEW."correlation_id"
       ) THEN
      RAISE EXCEPTION 'inconclusive provider reconciliation must atomically retain successor reconciliation custody'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."state" = 'cancelled' THEN
    IF EXISTS (
      SELECT 1 FROM "foundry_execution_events" invocation
      WHERE invocation."provider_command_id" = NEW."id"
        AND invocation."event_kind" = 'provider_invocation_started'
    ) THEN
      RAISE EXCEPTION 'an invoked provider command cannot be cancelled as pending'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."cancelled_by_stop_intent_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "foundry_stop_intents" s
      WHERE s."id" = NEW."cancelled_by_stop_intent_id"
        AND s."attempt_id" = NEW."attempt_id"
        AND s."fencing_token" = NEW."fencing_token"
    ) THEN
      RAISE EXCEPTION 'cancelled pending command lost its exact stop intent'
        USING ERRCODE = '23514';
    END IF;
    IF NEW."cancelled_by_provider_command_id" IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM "foundry_provider_commands" source_command
      WHERE source_command."id" = NEW."cancelled_by_provider_command_id"
        AND source_command."id" <> NEW."id"
        AND source_command."attempt_id" = NEW."attempt_id"
        AND source_command."fencing_token" = NEW."fencing_token"
        AND source_command."state" IN ('succeeded', 'failed', 'uncertain')
    ) THEN
      RAISE EXCEPTION 'cancelled pending command lost its exact terminalizing provider command'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_checkpoint_sequence"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_sequence bigint;
  rights_policy_version varchar(120);
  command_ok boolean;
BEGIN
  NEW."verified_at" := clock_timestamp();
  SELECT e."rights_policy_version" INTO rights_policy_version
  FROM "foundry_executions" e
  WHERE e."id" = NEW."execution_id";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'verified checkpoint execution scope is absent' USING ERRCODE = '23503';
  END IF;
  PERFORM "foundry_lock_rights_policy_version"(rights_policy_version);
  PERFORM "foundry_lock_execution_control_scopes"(
    NEW."provider_kind", NEW."provider_adapter_id", NEW."provider_adapter_version",
    NEW."project_id", NEW."execution_id", NEW."attempt_id"
  );
  SELECT true INTO command_ok
  FROM "foundry_attempts" a
  JOIN "foundry_provider_commands" c
    ON c."id" = NEW."provider_command_id"
   AND c."attempt_id" = a."id"
   AND c."execution_id" = a."execution_id"
   AND c."fencing_token" = a."fencing_token"
  WHERE a."id" = NEW."attempt_id"
    AND a."execution_id" = NEW."execution_id"
    AND a."project_id" = NEW."project_id"
    AND a."job_id" = NEW."job_id"
    AND a."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND a."provider_kind" = NEW."provider_kind"
    AND a."provider_adapter_id" = NEW."provider_adapter_id"
    AND a."provider_adapter_version" = NEW."provider_adapter_version"
    AND a."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND a."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND a."attempt_ordinal" = NEW."attempt_ordinal"
    AND a."fencing_token" = NEW."fencing_token"
    AND c."project_id" = NEW."project_id"
    AND c."job_id" = NEW."job_id"
    AND c."execution_envelope_sha256" = NEW."execution_envelope_sha256"
    AND c."provider_kind" = NEW."provider_kind"
    AND c."provider_adapter_id" = NEW."provider_adapter_id"
    AND c."provider_adapter_version" = NEW."provider_adapter_version"
    AND c."provider_adapter_artifact_sha256" = NEW."provider_adapter_artifact_sha256"
    AND c."provider_deployment_sha256" = NEW."provider_deployment_sha256"
    AND c."attempt_ordinal" = NEW."attempt_ordinal"
    AND c."command_kind" = 'provider_checkpoint'
    AND c."target_provider_ref" = a."provider_execution_ref"
    AND c."claimed_by" = NEW."verified_by"
    AND c."correlation_id" = NEW."correlation_id"
    AND c."state" IN ('claimed', 'succeeded')
    AND (
      c."state" = 'claimed'
      OR (
        c."outcome_sha256" = NEW."provider_command_outcome_sha256"
        AND c."completed_by_actor_kind" = 'service'
        AND c."completed_by_actor_key" = NEW."verified_by"
        AND c."outcome_json"->>'evidenceSha256' =
              "foundry_verified_checkpoint_evidence_sha256"(
                NEW."checkpoint_kind", NEW."provider_checkpoint_id",
                NEW."checkpoint_sha256", NEW."evidence_ref", NEW."provider_created_at"
              )
      )
    )
  FOR UPDATE OF a;
  IF command_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'verified checkpoint must bind the exact claimed or succeeded provider-checkpoint command'
      USING ERRCODE = '23514';
  END IF;
  SELECT COALESCE(MAX(c."checkpoint_sequence"), 0) + 1 INTO expected_sequence
  FROM "foundry_verified_checkpoints" c WHERE c."attempt_id" = NEW."attempt_id";
  IF NEW."checkpoint_sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'verified checkpoint sequence is not contiguous' USING ERRCODE = '40001';
  END IF;
  NEW."request_digest" := "foundry_verified_checkpoint_request_digest"(NEW);
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_checkpoint_command_closure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "foundry_provider_commands" c
    WHERE c."id" = NEW."provider_command_id"
      AND c."execution_id" = NEW."execution_id"
      AND c."attempt_id" = NEW."attempt_id"
      AND c."attempt_ordinal" = NEW."attempt_ordinal"
      AND c."fencing_token" = NEW."fencing_token"
      AND c."command_kind" = 'provider_checkpoint'
      AND c."state" = 'succeeded'
      AND c."outcome_sha256" = NEW."provider_command_outcome_sha256"
      AND c."completed_by_actor_kind" = 'service'
      AND c."completed_by_actor_key" = NEW."verified_by"
      AND c."outcome_json"->>'evidenceSha256' =
            "foundry_verified_checkpoint_evidence_sha256"(
              NEW."checkpoint_kind", NEW."provider_checkpoint_id",
              NEW."checkpoint_sha256", NEW."evidence_ref", NEW."provider_created_at"
            )
      AND c."correlation_id" = NEW."correlation_id"
      AND NEW."causation_id" = c."id"
      AND NEW."request_digest" = "foundry_verified_checkpoint_request_digest"(NEW)
  ) THEN
    RAISE EXCEPTION 'verified checkpoint must close against one exact succeeded provider-checkpoint command'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_attempt_containment_closure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  current_state varchar(40);
  current_cancel_requested boolean;
  current_provider_execution_ref varchar(240);
  current_fencing_token bigint;
BEGIN
  SELECT a."state", a."cancel_requested", a."provider_execution_ref", a."fencing_token"
  INTO current_state, current_cancel_requested, current_provider_execution_ref,
       current_fencing_token
  FROM "foundry_attempts" a
  WHERE a."id" = NEW."id";
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF left(current_state, 9) = 'terminal_' THEN
    IF EXISTS (
      SELECT 1
      FROM "foundry_provider_commands" c
      WHERE c."attempt_id" = NEW."id"
        AND c."fencing_token" = current_fencing_token
        AND c."state" = 'pending'
    ) THEN
      RAISE EXCEPTION 'a terminal attempt cannot retain an active provider command; retry serialized closure'
        USING ERRCODE = '40001';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT current_cancel_requested THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM "foundry_stop_intents" s
    WHERE s."attempt_id" = NEW."id"
      AND s."fencing_token" = current_fencing_token
  ) THEN
    RAISE EXCEPTION 'a live cancelled attempt must be backed by an immutable stop intent'
      USING ERRCODE = '23514';
  END IF;
  IF current_provider_execution_ref IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "foundry_provider_commands" c
      WHERE c."attempt_id" = NEW."id"
        AND c."fencing_token" = current_fencing_token
        AND c."command_kind" = 'provider_stop'
        AND c."state" IN ('pending', 'claimed')
        AND c."target_provider_ref" = current_provider_execution_ref
        AND c."stop_intent_id" IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'a live provider-bound containment projection must retain an active provider-stop command'
        USING ERRCODE = '23514';
    END IF;
  ELSIF current_state IN ('provider_unknown', 'stop_pending') AND NOT EXISTS (
    SELECT 1
    FROM "foundry_provider_commands" c
    WHERE c."attempt_id" = NEW."id"
      AND c."fencing_token" = current_fencing_token
      AND (
        (c."command_kind" = 'provider_submit' AND c."state" = 'claimed')
        OR (c."command_kind" = 'provider_reconcile' AND c."state" IN ('pending', 'claimed'))
      )
  ) THEN
    RAISE EXCEPTION 'containment with an unresolved provider resource must retain submit or reconciliation custody'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_kill_event_containment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."action" = 'activate' AND EXISTS (
    SELECT 1
    FROM "foundry_attempts" a
    JOIN "foundry_executions" e ON e."id" = a."execution_id"
    WHERE left(a."state", 9) <> 'terminal_'
      AND (
        NEW."scope" = 'global'
        OR (NEW."scope" = 'provider' AND EXISTS (
          SELECT 1 FROM "foundry_kill_switches" k
          WHERE k."id" = NEW."kill_switch_id"
            AND k."provider_kind" = e."provider_kind"
            AND k."provider_adapter_id" = e."provider_adapter_id"
            AND k."provider_adapter_version" = e."provider_adapter_version"
        ))
        OR (NEW."scope" = 'project' AND e."project_id" = split_part(NEW."target_key", ':', 2))
        OR (NEW."scope" = 'execution' AND e."id"::text = split_part(NEW."target_key", ':', 2))
        OR (NEW."scope" = 'attempt' AND a."id"::text = split_part(NEW."target_key", ':', 2))
      )
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_stop_intents" s
        WHERE s."attempt_id" = a."id"
          AND s."fencing_token" = a."fencing_token"
          AND s."source_kind" = 'kill_switch_event'
          AND s."source_id" = NEW."id"
          AND s."reason_code" = 'kill_' || NEW."scope"
      )
  ) THEN
    RAISE EXCEPTION 'kill activation must atomically create exact stop intents for every affected live attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_rights_revocation_containment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "foundry_attempts" a
    JOIN "foundry_executions" e ON e."id" = a."execution_id"
    WHERE left(a."state", 9) <> 'terminal_'
      AND e."rights_policy_version" = NEW."policy_version"
      AND e."rights_policy_definition_sha256" = NEW."policy_definition_sha256"
      AND e."rights_policy_generation" = NEW."policy_generation"
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_stop_intents" s
        WHERE s."attempt_id" = a."id"
          AND s."fencing_token" = a."fencing_token"
          AND s."source_kind" = 'rights_policy_revocation'
          AND s."source_id" = NEW."id"
          AND s."reason_code" = 'rights_revoked'
      )
  ) THEN
    RAISE EXCEPTION 'rights revocation must atomically create exact stop intents for every affected live attempt'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_cost_hard_stop_containment"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "foundry_attempts" a
    JOIN "foundry_executions" e ON e."id" = a."execution_id"
    WHERE a."id" = NEW."attempt_id"
      AND a."fencing_token" = NEW."fencing_token"
      AND left(a."state", 9) <> 'terminal_'
      AND e."total_cost_micro_usd" >= e."cost_hard_stop_micro_usd"
      AND NOT EXISTS (
        SELECT 1
        FROM "foundry_stop_intents" s
        WHERE s."attempt_id" = a."id"
          AND s."fencing_token" = a."fencing_token"
          AND s."source_kind" = 'cost_observation'
          AND s."source_id" = NEW."id"
          AND s."reason_code" = 'cost_hard_stop'
      )
  ) THEN
    RAISE EXCEPTION 'a hard-stop cost observation must atomically create its exact stop intent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION "guard_foundry_execution_ledger_closure"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  latest_event_revision bigint;
  execution_revision bigint;
  execution_state varchar(40);
  execution_cancel_requested boolean;
  latest_attempt_ordinal integer;
  attempt_state varchar(40);
  attempt_cancel_requested boolean;
BEGIN
  SELECT e."revision", e."state", e."cancel_requested", e."last_attempt_ordinal"
  INTO execution_revision, execution_state, execution_cancel_requested, latest_attempt_ordinal
  FROM "foundry_executions" e
  WHERE e."id" = NEW."id";
  SELECT max(ev."resulting_revision")
  INTO latest_event_revision
  FROM "foundry_execution_events" ev
  WHERE ev."execution_id" = NEW."id";
  IF latest_event_revision IS DISTINCT FROM execution_revision THEN
    RAISE EXCEPTION 'execution projection revision must close exactly against its append-only ledger'
      USING ERRCODE = '23514';
  END IF;
  IF latest_attempt_ordinal > 0 THEN
    SELECT a."state", a."cancel_requested"
    INTO attempt_state, attempt_cancel_requested
    FROM "foundry_attempts" a
    WHERE a."execution_id" = NEW."id"
      AND a."attempt_ordinal" = latest_attempt_ordinal;
    IF NOT FOUND
       OR attempt_state IS DISTINCT FROM execution_state
       OR attempt_cancel_requested IS DISTINCT FROM execution_cancel_requested THEN
      RAISE EXCEPTION 'execution and latest attempt projections must remain exactly synchronized'
        USING ERRCODE = '23514';
    END IF;
  ELSIF execution_state <> 'admitted_awaiting_executor' THEN
    RAISE EXCEPTION 'an execution without an attempt must remain inert'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "foundry_exec_projection_guard"
  BEFORE INSERT OR UPDATE ON "foundry_executions"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_execution_projection"();
CREATE TRIGGER "foundry_job_pricing_snapshot_age_guard"
  BEFORE INSERT ON "foundry_jobs"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_job_pricing_snapshot_age"();
CREATE CONSTRAINT TRIGGER "foundry_execution_ledger_closure_guard"
  AFTER INSERT OR UPDATE ON "foundry_executions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_execution_ledger_closure"();
CREATE TRIGGER "foundry_job_worker_profile_guard"
  BEFORE INSERT ON "foundry_job_worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_job_worker_profile"();
CREATE TRIGGER "foundry_provider_request_profile_guard"
  BEFORE INSERT ON "foundry_provider_request_profiles"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_provider_request_profile"();
CREATE TRIGGER "foundry_prepared_provider_request_guard"
  BEFORE INSERT ON "foundry_prepared_provider_requests"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_prepared_provider_request"();
CREATE CONSTRAINT TRIGGER "foundry_prepared_provider_request_closure_guard"
  AFTER INSERT ON "foundry_prepared_provider_requests"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_prepared_provider_request_closure"();
CREATE TRIGGER "foundry_stop_intent_guard"
  BEFORE INSERT ON "foundry_stop_intents"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_stop_intent"();
CREATE TRIGGER "foundry_stop_intent_apply_event"
  AFTER INSERT ON "foundry_stop_intents"
  FOR EACH ROW EXECUTE FUNCTION "append_foundry_stop_intent_application_event"();
CREATE TRIGGER "foundry_stop_intent_cancel_pending_submit"
  AFTER INSERT ON "foundry_stop_intents"
  FOR EACH ROW EXECUTE FUNCTION "apply_foundry_stop_intent_outbox_cancellation"();
CREATE TRIGGER "foundry_rights_policy_version_guard"
  BEFORE INSERT ON "foundry_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_rights_policy_version"();
CREATE TRIGGER "foundry_rights_revocation_guard"
  BEFORE INSERT ON "foundry_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_rights_policy_revocation"();
CREATE TRIGGER "foundry_rights_approval_guard"
  BEFORE INSERT ON "foundry_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_rights_approval"();
CREATE TRIGGER "foundry_compute_approval_guard"
  BEFORE INSERT ON "foundry_compute_approvals"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_compute_approval"();
CREATE TRIGGER "foundry_execution_confirmation_guard"
  BEFORE INSERT ON "foundry_execution_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_execution_confirmation"();
CREATE CONSTRAINT TRIGGER "foundry_rights_revocation_containment_guard"
  AFTER INSERT ON "foundry_rights_policy_revocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_rights_revocation_containment"();
CREATE TRIGGER "foundry_attempt_projection_guard"
  BEFORE INSERT OR UPDATE ON "foundry_attempts"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_attempt_projection"();
CREATE CONSTRAINT TRIGGER "foundry_attempt_containment_closure_guard"
  AFTER INSERT OR UPDATE ON "foundry_attempts"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_attempt_containment_closure"();
CREATE TRIGGER "foundry_kill_projection_guard"
  BEFORE INSERT OR UPDATE ON "foundry_kill_switches"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_kill_switch_projection"();
CREATE TRIGGER "foundry_kill_event_apply"
  BEFORE INSERT ON "foundry_kill_switch_events"
  FOR EACH ROW EXECUTE FUNCTION "apply_foundry_kill_switch_event"();
CREATE CONSTRAINT TRIGGER "foundry_kill_event_containment_guard"
  AFTER INSERT ON "foundry_kill_switch_events"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_kill_event_containment"();
CREATE TRIGGER "foundry_event_sequence_guard"
  BEFORE INSERT ON "foundry_execution_events"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_execution_event_sequence"();
CREATE TRIGGER "foundry_command_projection_guard"
  BEFORE INSERT OR UPDATE ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_provider_command"();
CREATE TRIGGER "foundry_command_update_root_lock"
  BEFORE UPDATE ON "foundry_provider_commands"
  FOR EACH STATEMENT EXECUTE FUNCTION "lock_foundry_execution_control_root"();
CREATE TRIGGER "foundry_command_transition_event_append"
  AFTER INSERT OR UPDATE ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "append_foundry_provider_command_transition_event"();
CREATE CONSTRAINT TRIGGER "foundry_uncertain_submit_reconcile_guard"
  AFTER INSERT OR UPDATE ON "foundry_provider_commands"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_uncertain_submit_reconciliation"();
CREATE CONSTRAINT TRIGGER "foundry_provider_command_terminal_closure_guard"
  AFTER INSERT OR UPDATE ON "foundry_provider_commands"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_provider_command_terminal_closure"();
CREATE TRIGGER "foundry_provider_result_observation_guard"
  BEFORE INSERT ON "foundry_provider_command_result_observations"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_provider_result_observation"();
CREATE TRIGGER "foundry_provider_result_classification_guard"
  BEFORE INSERT ON "foundry_provider_command_result_classifications"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_provider_result_classification"();
CREATE TRIGGER "foundry_cost_observation_apply"
  BEFORE INSERT ON "foundry_cost_observations"
  FOR EACH ROW EXECUTE FUNCTION "apply_foundry_cost_observation"();
CREATE TRIGGER "foundry_cost_observation_apply_event"
  AFTER INSERT ON "foundry_cost_observations"
  FOR EACH ROW EXECUTE FUNCTION "append_foundry_cost_observation_application_event"();
CREATE CONSTRAINT TRIGGER "foundry_cost_hard_stop_containment_guard"
  AFTER INSERT ON "foundry_cost_observations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_cost_hard_stop_containment"();
CREATE TRIGGER "foundry_checkpoint_sequence_guard"
  BEFORE INSERT ON "foundry_verified_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_checkpoint_sequence"();
CREATE CONSTRAINT TRIGGER "foundry_checkpoint_command_closure_guard"
  AFTER INSERT ON "foundry_verified_checkpoints"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "guard_foundry_checkpoint_command_closure"();

-- Immutable authority/evidence tables: no UPDATE, DELETE, or TRUNCATE.
CREATE TRIGGER "foundry_execution_policies_no_update" BEFORE UPDATE ON "foundry_execution_policies"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_execution_policies_no_delete" BEFORE DELETE ON "foundry_execution_policies"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_execution_policies_no_truncate" BEFORE TRUNCATE ON "foundry_execution_policies"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_adapter_artifacts_no_update" BEFORE UPDATE ON "foundry_provider_adapter_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_adapter_artifacts_no_delete" BEFORE DELETE ON "foundry_provider_adapter_artifacts"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_adapter_artifacts_no_truncate" BEFORE TRUNCATE ON "foundry_provider_adapter_artifacts"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_deployments_no_update" BEFORE UPDATE ON "foundry_provider_deployments"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_deployments_no_delete" BEFORE DELETE ON "foundry_provider_deployments"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_deployments_no_truncate" BEFORE TRUNCATE ON "foundry_provider_deployments"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_provider_request_profiles_no_update" BEFORE UPDATE ON "foundry_provider_request_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_provider_request_profiles_no_delete" BEFORE DELETE ON "foundry_provider_request_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_provider_request_profiles_no_truncate" BEFORE TRUNCATE ON "foundry_provider_request_profiles"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_worker_profiles_no_update" BEFORE UPDATE ON "foundry_trusted_worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_worker_profiles_no_delete" BEFORE DELETE ON "foundry_trusted_worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_worker_profiles_no_truncate" BEFORE TRUNCATE ON "foundry_trusted_worker_profiles"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_job_workers_no_update" BEFORE UPDATE ON "foundry_job_worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_job_workers_no_delete" BEFORE DELETE ON "foundry_job_worker_profiles"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_job_workers_no_truncate" BEFORE TRUNCATE ON "foundry_job_worker_profiles"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_stop_intents_no_update" BEFORE UPDATE ON "foundry_stop_intents"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_stop_intents_no_delete" BEFORE DELETE ON "foundry_stop_intents"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_stop_intents_no_truncate" BEFORE TRUNCATE ON "foundry_stop_intents"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_prepared_requests_no_update" BEFORE UPDATE ON "foundry_prepared_provider_requests"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_prepared_requests_no_delete" BEFORE DELETE ON "foundry_prepared_provider_requests"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_prepared_requests_no_truncate" BEFORE TRUNCATE ON "foundry_prepared_provider_requests"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_jobs_no_update" BEFORE UPDATE ON "foundry_jobs"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_jobs_no_delete" BEFORE DELETE ON "foundry_jobs"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_jobs_no_truncate" BEFORE TRUNCATE ON "foundry_jobs"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_policy_no_update" BEFORE UPDATE ON "foundry_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_policy_no_delete" BEFORE DELETE ON "foundry_rights_policy_versions"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_policy_no_truncate" BEFORE TRUNCATE ON "foundry_rights_policy_versions"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_revocations_no_update" BEFORE UPDATE ON "foundry_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_revocations_no_delete" BEFORE DELETE ON "foundry_rights_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_revocations_no_truncate" BEFORE TRUNCATE ON "foundry_rights_policy_revocations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_no_update" BEFORE UPDATE ON "foundry_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_no_delete" BEFORE DELETE ON "foundry_rights_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_rights_no_truncate" BEFORE TRUNCATE ON "foundry_rights_approvals"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_compute_no_update" BEFORE UPDATE ON "foundry_compute_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_compute_no_delete" BEFORE DELETE ON "foundry_compute_approvals"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_compute_no_truncate" BEFORE TRUNCATE ON "foundry_compute_approvals"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_confirmations_no_update" BEFORE UPDATE ON "foundry_execution_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_confirmations_no_delete" BEFORE DELETE ON "foundry_execution_confirmations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_confirmations_no_truncate" BEFORE TRUNCATE ON "foundry_execution_confirmations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_events_no_update" BEFORE UPDATE ON "foundry_execution_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_events_no_delete" BEFORE DELETE ON "foundry_execution_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_events_no_truncate" BEFORE TRUNCATE ON "foundry_execution_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_observations_no_update" BEFORE UPDATE ON "foundry_provider_command_result_observations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_observations_no_delete" BEFORE DELETE ON "foundry_provider_command_result_observations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_observations_no_truncate" BEFORE TRUNCATE ON "foundry_provider_command_result_observations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_classifications_no_update" BEFORE UPDATE ON "foundry_provider_command_result_classifications"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_classifications_no_delete" BEFORE DELETE ON "foundry_provider_command_result_classifications"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_result_classifications_no_truncate" BEFORE TRUNCATE ON "foundry_provider_command_result_classifications"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_cost_no_update" BEFORE UPDATE ON "foundry_cost_observations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_cost_no_delete" BEFORE DELETE ON "foundry_cost_observations"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_cost_no_truncate" BEFORE TRUNCATE ON "foundry_cost_observations"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_checkpoints_no_update" BEFORE UPDATE ON "foundry_verified_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_checkpoints_no_delete" BEFORE DELETE ON "foundry_verified_checkpoints"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_checkpoints_no_truncate" BEFORE TRUNCATE ON "foundry_verified_checkpoints"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_kill_events_no_update" BEFORE UPDATE ON "foundry_kill_switch_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_kill_events_no_delete" BEFORE DELETE ON "foundry_kill_switch_events"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_append_only_mutation"();
CREATE TRIGGER "foundry_kill_events_no_truncate" BEFORE TRUNCATE ON "foundry_kill_switch_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_append_only_mutation"();

-- Mutable projections/outbox retain their rows but permit guarded UPDATE.
CREATE TRIGGER "foundry_exec_no_delete" BEFORE DELETE ON "foundry_executions"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_exec_no_truncate" BEFORE TRUNCATE ON "foundry_executions"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_attempt_no_delete" BEFORE DELETE ON "foundry_attempts"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_attempt_no_truncate" BEFORE TRUNCATE ON "foundry_attempts"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_command_no_delete" BEFORE DELETE ON "foundry_provider_commands"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_command_no_truncate" BEFORE TRUNCATE ON "foundry_provider_commands"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_kill_no_delete" BEFORE DELETE ON "foundry_kill_switches"
  FOR EACH ROW EXECUTE FUNCTION "deny_foundry_row_removal"();
CREATE TRIGGER "foundry_kill_no_truncate" BEFORE TRUNCATE ON "foundry_kill_switches"
  FOR EACH STATEMENT EXECUTE FUNCTION "deny_foundry_row_removal"();
