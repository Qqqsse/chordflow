CREATE TABLE "generation_artifacts" (
	"job_id" text NOT NULL,
	"position" integer NOT NULL,
	"entry" jsonb NOT NULL,
	CONSTRAINT "generation_artifacts_job_id_position_pk" PRIMARY KEY("job_id","position")
);
--> statement-breakpoint
CREATE TABLE "generation_job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"attempt" integer NOT NULL,
	"actor" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_job_events_actor" CHECK (actor in ('user', 'worker', 'system', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"request" jsonb NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"lease_owner" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"lease_seconds" integer,
	"released_lease_token" text,
	"not_before" timestamp with time zone,
	"progress" jsonb,
	"error_code" text,
	"error_message" text,
	"error_retryable" boolean,
	"completion_digest" text,
	"quality" jsonb,
	"processor_id" text,
	"processor_version" text,
	"result_arrangement_id" text,
	"result_revision_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "generation_jobs_state" CHECK (state in ('created', 'validated', 'queued', 'leased', 'running', 'failed_retryable', 'draft_ready', 'needs_review', 'published', 'failed_terminal', 'cancelled')),
	CONSTRAINT "generation_jobs_attempts" CHECK ("generation_jobs"."attempt" >= 0 and "generation_jobs"."max_attempts" >= 1),
	CONSTRAINT "generation_jobs_lease" CHECK (("generation_jobs"."lease_token" is null) = ("generation_jobs"."lease_owner" is null) and ("generation_jobs"."lease_token" is null) = ("generation_jobs"."lease_expires_at" is null))
);
--> statement-breakpoint
CREATE TABLE "worker_presence" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"worker_version" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_artifacts" ADD CONSTRAINT "generation_artifacts_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job_events" ADD CONSTRAINT "generation_job_events_job_id_generation_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_created_by_auth_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."auth_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_result_arrangement_id_arrangements_id_fk" FOREIGN KEY ("result_arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_result_revision_id_chart_revisions_id_fk" FOREIGN KEY ("result_revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_job_events_job" ON "generation_job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_idempotency" ON "generation_jobs" USING btree ("created_by","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "generation_jobs_active_fingerprint" ON "generation_jobs" USING btree ("created_by","request_fingerprint") WHERE state in ('created', 'validated', 'queued', 'leased', 'running', 'failed_retryable', 'draft_ready', 'needs_review');--> statement-breakpoint
CREATE INDEX "generation_jobs_claimable" ON "generation_jobs" USING btree ("state","not_before","created_at");--> statement-breakpoint
CREATE INDEX "generation_jobs_created_by" ON "generation_jobs" USING btree ("created_by","created_at");--> statement-breakpoint

-- Jobs start in "created" and move only along the state machine in
-- @chordflow/chart-schema (jobs.ts); jobs-migration.test.ts keeps the two in sync.
CREATE FUNCTION chordflow_generation_job_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."state" <> 'created' THEN
      RAISE EXCEPTION 'JOB_TRANSITION_INVALID: jobs start in created, not %', NEW."state"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW."id" <> OLD."id"
     OR NEW."created_by" <> OLD."created_by"
     OR NEW."idempotency_key" <> OLD."idempotency_key"
     OR NEW."request_fingerprint" <> OLD."request_fingerprint"
     OR NEW."request" IS DISTINCT FROM OLD."request" THEN
    RAISE EXCEPTION 'JOB_REQUEST_IMMUTABLE: job % request cannot change', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."state" <> OLD."state" AND (OLD."state", NEW."state") NOT IN (VALUES
    ('created', 'validated'),
    ('created', 'failed_terminal'),
    ('created', 'cancelled'),
    ('validated', 'queued'),
    ('validated', 'failed_terminal'),
    ('validated', 'cancelled'),
    ('queued', 'leased'),
    ('queued', 'cancelled'),
    ('leased', 'running'),
    ('leased', 'queued'),
    ('leased', 'failed_retryable'),
    ('leased', 'failed_terminal'),
    ('leased', 'cancelled'),
    ('running', 'draft_ready'),
    ('running', 'queued'),
    ('running', 'failed_retryable'),
    ('running', 'failed_terminal'),
    ('running', 'cancelled'),
    ('failed_retryable', 'queued'),
    ('failed_retryable', 'failed_terminal'),
    ('failed_retryable', 'cancelled'),
    ('draft_ready', 'needs_review'),
    ('needs_review', 'published'),
    ('needs_review', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'JOB_TRANSITION_INVALID: % -> %', OLD."state", NEW."state"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "generation_jobs_guard"
  BEFORE INSERT OR UPDATE ON "generation_jobs"
  FOR EACH ROW EXECUTE FUNCTION chordflow_generation_job_guard();
