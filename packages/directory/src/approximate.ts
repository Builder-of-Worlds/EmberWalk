export const MARK_APPROXIMATE_SQL =
  "UPDATE crews SET approximate = CASE WHEN EXISTS (SELECT 1 FROM zip_centres z WHERE z.zip = crews.zip) THEN 0 ELSE 1 END;";
