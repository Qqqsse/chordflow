CREATE TABLE "recent_views" (
	"user_id" text NOT NULL,
	"arrangement_id" text NOT NULL,
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recent_views_user_id_arrangement_id_pk" PRIMARY KEY("user_id","arrangement_id")
);
--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recent_views" ADD CONSTRAINT "recent_views_arrangement_id_arrangements_id_fk" FOREIGN KEY ("arrangement_id") REFERENCES "public"."arrangements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recent_views_user_time" ON "recent_views" USING btree ("user_id","viewed_at");