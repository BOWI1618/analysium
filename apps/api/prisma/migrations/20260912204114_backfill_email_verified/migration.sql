-- Accounts that existed before e-mail verification was introduced were never
-- asked to prove their address. Leaving them unverified would lock every
-- existing user out the moment MAIL_ENABLED is switched on — the people already
-- using the product, punished for a feature added after they signed up.
--
-- They are marked verified as of when they were created. Only accounts made
-- from here on have to confirm. Every NULL at this point in the migration
-- history is by definition a pre-feature account: verification did not exist
-- when they were written.
UPDATE "users"
SET "emailVerifiedAt" = "createdAt"
WHERE "emailVerifiedAt" IS NULL
  AND "passwordHash" IS NOT NULL;
