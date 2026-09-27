-- ---------------------------------------------------------------------------
-- 0081 — trigram matching for the client search (T-635, roadmap X1)
--
-- Staff look a client up while the client is on the phone, and a name is
-- often heard rather than read: "Mcdonald" for "MacDonald", "Hendersen" for
-- "Henderson". The search matched substrings only (ILIKE), so either found
-- nothing. pg_trgm scores how many three-letter runs two strings share, which
-- finds both, and is one of the extensions Neon provides; 0050 created
-- btree_gist the same way.
--
-- This migration only makes the extension available. It ships, and is applied,
-- before any code that uses it, because Railway rebuilds the API as soon as
-- master moves and Deploy migrates only after CI: code that called
-- similarity() before this ran would fail every search. No table changes.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;
