-- -----------------------------------------------------------------------------
-- 0036_runtime_asset_sog_lcc2_extensions
--
-- Let the runtime asset registry store XGRIDS/LCC2 outputs found for the
-- Reception Room. `.sog` is a Spark-loadable splat chunk. `.lcc2` is stored as
-- provenance/manifest material only; it is not treated as a primary splat URL.
-- -----------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'asset_versions_file_ext_check') THEN
    ALTER TABLE "asset_versions" DROP CONSTRAINT "asset_versions_file_ext_check";
  END IF;

  ALTER TABLE "asset_versions"
    ADD CONSTRAINT "asset_versions_file_ext_check"
    CHECK ("file_ext" IN (
      '.ply', '.spz', '.splat', '.ksplat', '.sog', '.rad', '.radc',
      '.glb', '.gltf', '.obj', '.e57', '.las', '.laz',
      '.zip', '.json', '.lcc2', '.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov'
    ));
END $$;
