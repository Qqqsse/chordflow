CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "arrangement_recordings" (
	"arrangement_id" text NOT NULL,
	"recording_id" text NOT NULL,
	"provenance" text NOT NULL,
	"recorded_key" text,
	"transpose_semitones" integer,
	"cross_work_reviewed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrangement_recordings_arrangement_id_recording_id_pk" PRIMARY KEY("arrangement_id","recording_id"),
	CONSTRAINT "arrangement_recordings_provenance" CHECK (provenance in ('exact_audio_match', 'human_verified', 'suggested', 'unknown')),
	CONSTRAINT "arrangement_recordings_transpose" CHECK ("arrangement_recordings"."transpose_semitones" is null or "arrangement_recordings"."transpose_semitones" between -11 and 11)
);
--> statement-breakpoint
CREATE TABLE "arrangements" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"name" text NOT NULL,
	"variant" text NOT NULL,
	"published_revision_id" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"owner_user_id" text,
	"rights_lyrics" text DEFAULT 'unknown' NOT NULL,
	"rights_chart" text DEFAULT 'unknown' NOT NULL,
	"rights_audio" text DEFAULT 'unknown' NOT NULL,
	"rights_attribution" text,
	"rights_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arrangements_variant" CHECK (variant in ('original', 'simplified', 'capo_friendly', 'other')),
	CONSTRAINT "arrangements_visibility" CHECK (visibility in ('private', 'shared', 'public')),
	CONSTRAINT "arrangements_rights_lyrics" CHECK (rights_lyrics in ('unknown', 'synthetic', 'owner_original', 'licensed', 'permission_granted', 'public_domain', 'not_permitted')),
	CONSTRAINT "arrangements_rights_chart" CHECK (rights_chart in ('unknown', 'synthetic', 'owner_original', 'licensed', 'permission_granted', 'public_domain', 'not_permitted')),
	CONSTRAINT "arrangements_rights_audio" CHECK (rights_audio in ('unknown', 'synthetic', 'owner_original', 'licensed', 'permission_granted', 'public_domain', 'not_permitted'))
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"arrangement_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"origin" text NOT NULL,
	"parent_revision_id" text,
	"document" jsonb NOT NULL,
	"schema_version" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chart_revisions_status" CHECK (status in ('draft', 'needs_review', 'published', 'rejected')),
	CONSTRAINT "chart_revisions_origin" CHECK (origin in ('human', 'chordpro_import', 'ai_draft')),
	CONSTRAINT "chart_revisions_revision" CHECK ("chart_revisions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "recording_artists" (
	"recording_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recording_artists_recording_id_artist_id_role_pk" PRIMARY KEY("recording_id","artist_id","role"),
	CONSTRAINT "recording_artists_role" CHECK (role in ('performer', 'featured'))
);
--> statement-breakpoint
CREATE TABLE "recording_sources" (
	"recording_id" text NOT NULL,
	"source_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recording_sources_recording_id_source_id_pk" PRIMARY KEY("recording_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "recording_syncs" (
	"recording_id" text NOT NULL,
	"chart_revision_id" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recording_syncs_recording_id_chart_revision_id_pk" PRIMARY KEY("recording_id","chart_revision_id")
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" text PRIMARY KEY NOT NULL,
	"work_id" text NOT NULL,
	"title" text,
	"kind" text NOT NULL,
	"duration_ms" integer,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recordings_kind" CHECK (kind in ('studio', 'live', 'cover', 'acoustic', 'unknown')),
	CONSTRAINT "recordings_duration" CHECK ("recordings"."duration_ms" is null or "recordings"."duration_ms" > 0)
);
--> statement-breakpoint
CREATE TABLE "source_references" (
	"id" text PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_source_id" text,
	"url" text,
	"metadata" jsonb NOT NULL,
	"permission" text NOT NULL,
	"permitted_uses" text[] DEFAULT '{}'::text[] NOT NULL,
	"acquired_at" timestamp with time zone NOT NULL,
	CONSTRAINT "source_platform" CHECK (platform in ('youtube', 'spotify', 'apple_music', 'musicbrainz', 'user_upload', 'other')),
	CONSTRAINT "source_permission" CHECK (permission in ('unknown', 'discovery_only', 'analysis_permitted', 'denied')),
	CONSTRAINT "source_url_https" CHECK ("source_references"."url" is null or "source_references"."url" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE "work_credits" (
	"work_id" text NOT NULL,
	"artist_id" text NOT NULL,
	"role" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "work_credits_work_id_artist_id_role_pk" PRIMARY KEY("work_id","artist_id","role"),
	CONSTRAINT "work_credits_role" CHECK (role in ('composer', 'lyricist', 'arranger', 'original_artist'))
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"language" text,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "arrangement_recordings" ADD CONSTRAINT "arrangement_recordings_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangement_recordings" ADD CONSTRAINT "arrangement_recordings_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arrangements" ADD CONSTRAINT "arrangements_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_revisions" ADD CONSTRAINT "chart_revisions_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_artists" ADD CONSTRAINT "recording_artists_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_artists" ADD CONSTRAINT "recording_artists_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sources" ADD CONSTRAINT "recording_sources_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_sources" ADD CONSTRAINT "recording_sources_source_id_source_references_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."source_references"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_syncs" ADD CONSTRAINT "recording_syncs_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_syncs" ADD CONSTRAINT "recording_syncs_chart_revision_id_chart_revisions_id_fk" FOREIGN KEY ("chart_revision_id") REFERENCES "public"."chart_revisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_credits" ADD CONSTRAINT "work_credits_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_credits" ADD CONSTRAINT "work_credits_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "arrangement_recordings_recording" ON "arrangement_recordings" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX "arrangements_work" ON "arrangements" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chart_revisions_number" ON "chart_revisions" USING btree ("arrangement_id","revision");--> statement-breakpoint
CREATE INDEX "recordings_work" ON "recordings" USING btree ("work_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_platform_id" ON "source_references" USING btree ("platform","platform_source_id") WHERE "source_references"."platform_source_id" is not null;--> statement-breakpoint
CREATE INDEX "works_search_trgm" ON "works" USING gin ("search_text" gin_trgm_ops);