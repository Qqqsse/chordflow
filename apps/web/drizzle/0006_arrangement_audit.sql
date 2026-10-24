CREATE TABLE "arrangement_audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"arrangement_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrangement_audit_events_action" CHECK (action in ('created', 'settings_changed', 'revision_published'))
);
--> statement-breakpoint
ALTER TABLE "arrangement_audit_events" ADD CONSTRAINT "arrangement_audit_events_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_audit_events" ADD CONSTRAINT "arrangement_audit_events_actor_user_id_auth_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arrangement_audit_events_arrangement" ON "arrangement_audit_events" USING btree ("arrangement_id","id");--> statement-breakpoint

-- The audit log is append-only: history can be added to, never rewritten.
CREATE FUNCTION chordflow_audit_append_only() RETURNS trigger AS $$
BEGIN
  -- Only exception: deleting a user anonymises their events (actor -> NULL, nothing else).
  IF TG_OP = 'UPDATE' AND NEW."actor_user_id" IS NULL
     AND (NEW."id", NEW."arrangement_id", NEW."action", NEW."before", NEW."after", NEW."details", NEW."created_at")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."arrangement_id", OLD."action", OLD."before", OLD."after", OLD."details", OLD."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AUDIT_APPEND_ONLY: arrangement audit events cannot be changed or deleted'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "arrangement_audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "arrangement_audit_events"
  FOR EACH ROW EXECUTE FUNCTION chordflow_audit_append_only();
