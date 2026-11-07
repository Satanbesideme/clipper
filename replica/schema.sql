-- GALSURKU Clipper — SQLite schema (migration 0001)
pragma foreign_keys = on;

create table projects (
  id            text primary key,              -- uuid v4
  name          text not null,
  source_path   text not null,                 -- file VOD asli
  playable_path text,                          -- hasil remux MP4 (atau sama dengan source)
  duration_ms   integer not null check (duration_ms > 0),
  fps           real not null,
  width         integer not null,
  height        integer not null,
  audio_tracks  integer not null default 1,
  cache_status  text not null default 'pending'
    check (cache_status in ('pending','building','ready','failed')),
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
create index projects_updated on projects (updated_at desc);

create table layouts (
  id            text primary key,
  name          text not null,
  type          text not null check (type in ('crop','split')),
  main_x real not null, main_y real not null, main_w real not null, main_h real not null, -- 0..1 relatif sumber
  cam_x  real, cam_y  real, cam_w  real, cam_h  real,                                    -- hanya untuk split
  cam_position  text check (cam_position in ('top','bottom')),
  cam_ratio     real not null default 0.4,    -- porsi tinggi 9:16 untuk facecam
  is_preset     integer not null default 0,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  constraint split_has_cam check (
    type = 'crop' or (cam_x is not null and cam_y is not null and cam_w is not null and cam_h is not null and cam_position is not null)
  )
);

create table clips (
  id          text primary key,
  project_id  text not null references projects(id) on delete cascade,
  in_ms       integer not null check (in_ms >= 0),
  out_ms      integer not null,
  title       text not null default '',
  layout_id   text references layouts(id) on delete set null,
  status      text not null default 'draft' check (status in ('draft','ready','exported')),
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  constraint clip_length check (out_ms > in_ms)
);
create index clips_project on clips (project_id, in_ms);
create index clips_layout on clips (layout_id);

create table text_items (
  id        text primary key,
  clip_id   text not null references clips(id) on delete cascade,
  kind      text not null check (kind in ('title','caption')),
  text      text not null,
  start_ms  integer not null,                  -- relatif awal klip
  end_ms    integer not null,
  style     text not null default '{}',        -- json: font, ukuran, warna, posisi, highlight per kata
  words     text,                              -- json: timing per kata dari whisper (opsional)
  constraint text_length check (end_ms > start_ms)
);
create index text_items_clip on text_items (clip_id, start_ms);

create table export_jobs (
  id          text primary key,
  clip_id     text not null references clips(id) on delete cascade,
  preset      text not null check (preset in ('tiktok','shorts','custom')),
  width       integer not null default 1080,
  height      integer not null default 1920,
  fps         integer not null default 60 check (fps in (30,60)),
  bitrate_k   integer not null default 12000,
  encoder     text,                            -- h264_nvenc | h264_qsv | h264_amf | libx264
  out_path    text,
  status      text not null default 'queued'
    check (status in ('queued','running','done','failed','cancelled')),
  progress    real not null default 0 check (progress between 0 and 1),
  error       text,
  created_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at text
);
create index export_jobs_status on export_jobs (status, created_at);
create index export_jobs_clip on export_jobs (clip_id);

create table settings (
  key   text primary key,
  value text not null
);

-- preset bawaan
insert into layouts (id,name,type,main_x,main_y,main_w,main_h,is_preset)
values ('preset-center','Crop tengah','crop',0.3418,0,0.3164,1,1);
insert into layouts (id,name,type,main_x,main_y,main_w,main_h,cam_x,cam_y,cam_w,cam_h,cam_position,cam_ratio,is_preset)
values ('preset-split','Facecam atas + gameplay','split',0.2365,0,0.527,1,0.75,0.684,0.25,0.316,'top',0.4,1);
