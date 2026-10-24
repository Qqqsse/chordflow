-- Cross-row catalog invariants (SPEC §4). The service layer checks the same
-- rules first and maps these errors (message prefix = stable code) to API errors.

-- Revision documents must agree with their row.
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_document_ids" CHECK (
  "document"->>'chartRevisionId' = "id"
  AND "document"->>'arrangementId' = "arrangement_id"
  AND ("document"->>'revision')::int = "revision"
  AND "document"->>'schemaVersion' = "schema_version"
);
--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_parent_fk"
  FOREIGN KEY ("parent_revision_id") REFERENCES "chart_revisions"("id");
--> statement-breakpoint
ALTER TABLE "recording_syncs" ADD CONSTRAINT "recording_syncs_document_ids" CHECK (
  "document"->>'recordingId' = "recording_id"
  AND "document"->>'chartRevisionId' = "chart_revision_id"
);
--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_published_fk"
  FOREIGN KEY ("published_revision_id") REFERENCES "chart_revisions"("id")
  DEFERRABLE INITIALLY DEFERRED;
--> statement-breakpoint

-- Revisions are immutable: only the review status may move forward.
CREATE FUNCTION chordflow_chart_revision_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'published' THEN
      RAISE EXCEPTION 'CHART_REVISION_IMMUTABLE: published revision % cannot be deleted', OLD."id"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."document" IS DISTINCT FROM OLD."document"
     OR NEW."id" <> OLD."id"
     OR NEW."arrangement_id" <> OLD."arrangement_id"
     OR NEW."revision" <> OLD."revision"
     OR NEW."origin" <> OLD."origin"
     OR NEW."schema_version" <> OLD."schema_version"
     OR NEW."parent_revision_id" IS DISTINCT FROM OLD."parent_revision_id"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION 'CHART_REVISION_IMMUTABLE: revision % cannot be modified; create a new revision', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('published', 'rejected') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'CHART_REVISION_IMMUTABLE: % revision % is final', OLD."status", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "chart_revisions_guard"
  BEFORE UPDATE OR DELETE ON "chart_revisions"
  FOR EACH ROW EXECUTE FUNCTION chordflow_chart_revision_guard();
--> statement-breakpoint

-- The published pointer must name this arrangement's own published revision.
CREATE FUNCTION chordflow_published_pointer_guard() RETURNS trigger AS $$
DECLARE
  rev record;
BEGIN
  IF NEW."published_revision_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "arrangement_id", "status" INTO rev FROM "chart_revisions" WHERE "id" = NEW."published_revision_id";
  IF NOT FOUND OR rev."arrangement_id" <> NEW."id" OR rev."status" <> 'published' THEN
    RAISE EXCEPTION 'PUBLISHED_REVISION_INVALID: % is not a published revision of %',
      NEW."published_revision_id", NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "arrangements_published_guard"
  BEFORE INSERT OR UPDATE OF "published_revision_id" ON "arrangements"
  FOR EACH ROW EXECUTE FUNCTION chordflow_published_pointer_guard();
--> statement-breakpoint

-- Arrangement ↔ recording mappings stay within one Work unless explicitly reviewed.
CREATE FUNCTION chordflow_same_work_guard() RETURNS trigger AS $$
BEGIN
  IF NOT NEW."cross_work_reviewed" AND
     (SELECT "work_id" FROM "arrangements" WHERE "id" = NEW."arrangement_id") IS DISTINCT FROM
     (SELECT "work_id" FROM "recordings" WHERE "id" = NEW."recording_id") THEN
    RAISE EXCEPTION 'CROSS_WORK_MAPPING: arrangement % and recording % belong to different works',
      NEW."arrangement_id", NEW."recording_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "arrangement_recordings_same_work"
  BEFORE INSERT OR UPDATE ON "arrangement_recordings"
  FOR EACH ROW EXECUTE FUNCTION chordflow_same_work_guard();
--> statement-breakpoint

-- Timing is only stored for a recording the revision's arrangement is mapped to.
CREATE FUNCTION chordflow_sync_mapping_guard() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "arrangement_recordings" ar
    JOIN "chart_revisions" cr ON cr."arrangement_id" = ar."arrangement_id"
    WHERE cr."id" = NEW."chart_revision_id" AND ar."recording_id" = NEW."recording_id"
  ) THEN
    RAISE EXCEPTION 'SYNC_WITHOUT_MAPPING: recording % is not mapped to the arrangement of revision %',
      NEW."recording_id", NEW."chart_revision_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "recording_syncs_mapping"
  BEFORE INSERT OR UPDATE ON "recording_syncs"
  FOR EACH ROW EXECUTE FUNCTION chordflow_sync_mapping_guard();
