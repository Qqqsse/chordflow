CREATE TABLE "audio_rights_declarations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text,
	"source_id" text NOT NULL,
	"version" text NOT NULL,
	"text_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audio_rights_declarations_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "audio_rights_declarations_sha256" CHECK ("audio_rights_declarations"."text_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "audio_upload_blocks" (
	"user_id" text PRIMARY KEY NOT NULL,
	"blocked_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audio_uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"owner_user_id" text NOT NULL,
	"title" text NOT NULL,
	"artist" text,
	"format" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"storage_path" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"declaration_id" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"file_deleted_at" timestamp with time zone,
	CONSTRAINT "audio_uploads_source_id_unique" UNIQUE("source_id"),
	CONSTRAINT "audio_uploads_format" CHECK (format in ('wav', 'flac', 'mp3', 'ogg', 'm4a')),
	CONSTRAINT "audio_uploads_status" CHECK (status in ('active', 'withdrawn', 'expired')),
	CONSTRAINT "audio_uploads_size" CHECK ("audio_uploads"."size_bytes" > 0),
	CONSTRAINT "audio_uploads_sha256" CHECK ("audio_uploads"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "audio_uploads_ended" CHECK (("audio_uploads"."status" = 'active') = ("audio_uploads"."ended_at" is null))
);
--> statement-breakpoint
ALTER TABLE "audio_rights_declarations" ADD CONSTRAINT "audio_rights_declarations_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_rights_declarations" ADD CONSTRAINT "audio_rights_declarations_source_id_source_references_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_upload_blocks" ADD CONSTRAINT "audio_upload_blocks_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_upload_blocks" ADD CONSTRAINT "audio_upload_blocks_blocked_by_auth_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."auth_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_uploads" ADD CONSTRAINT "audio_uploads_source_id_source_references_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_uploads" ADD CONSTRAINT "audio_uploads_owner_user_id_auth_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_uploads" ADD CONSTRAINT "audio_uploads_declaration_id_audio_rights_declarations_id_fk" FOREIGN KEY ("declaration_id") REFERENCES "public"."audio_rights_declarations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_uploads_owner" ON "audio_uploads" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audio_uploads_status" ON "audio_uploads" USING btree ("status");--> statement-breakpoint

-- Rights declarations are append-only: what was agreed to can never be rewritten.
CREATE FUNCTION chordflow_declarations_append_only() RETURNS trigger AS $$
BEGIN
  -- Only exception: deleting a user anonymises their declarations (user -> NULL, nothing else).
  IF TG_OP = 'UPDATE' AND NEW."user_id" IS NULL
     AND (NEW."id", NEW."source_id", NEW."version", NEW."text_sha256", NEW."created_at")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."source_id", OLD."version", OLD."text_sha256", OLD."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'DECLARATION_APPEND_ONLY: rights declarations cannot be changed or deleted'
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audio_rights_declarations_append_only"
  BEFORE UPDATE OR DELETE ON "audio_rights_declarations"
  FOR EACH ROW EXECUTE FUNCTION chordflow_declarations_append_only();
--> statement-breakpoint

-- An upload's identity and file never change; it ends at most once and its file is deleted at most once.
CREATE FUNCTION chordflow_audio_upload_guard() RETURNS trigger AS $$
BEGIN
  IF (NEW."id", NEW."source_id", NEW."owner_user_id", NEW."title", NEW."artist", NEW."format",
      NEW."size_bytes", NEW."sha256", NEW."storage_path", NEW."declaration_id", NEW."created_at")
     IS DISTINCT FROM
     (OLD."id", OLD."source_id", OLD."owner_user_id", OLD."title", OLD."artist", OLD."format",
      OLD."size_bytes", OLD."sha256", OLD."storage_path", OLD."declaration_id", OLD."created_at") THEN
    RAISE EXCEPTION 'AUDIO_UPLOAD_IMMUTABLE: upload identity and file cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'active'
     AND (NEW."status", NEW."ended_at") IS DISTINCT FROM (OLD."status", OLD."ended_at") THEN
    RAISE EXCEPTION 'AUDIO_UPLOAD_ENDED: a withdrawn or expired upload cannot change status'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."file_deleted_at" IS NOT NULL
     AND NEW."file_deleted_at" IS DISTINCT FROM OLD."file_deleted_at" THEN
    RAISE EXCEPTION 'AUDIO_UPLOAD_FILE_DELETED: the file deletion time cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."file_deleted_at" IS NOT NULL AND NEW."status" = 'active' THEN
    RAISE EXCEPTION 'AUDIO_UPLOAD_ACTIVE: an active upload must keep its file'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "audio_uploads_guard"
  BEFORE UPDATE ON "audio_uploads"
  FOR EACH ROW EXECUTE FUNCTION chordflow_audio_upload_guard();