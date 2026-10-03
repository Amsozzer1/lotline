-- Run history for simulated chip-processing tools.
-- Frames are one wide row per tool tick (10 Hz). Features and summaries are written once per run.

create table tool (
  id text primary key,
  display_name text not null,
  sim_seed integer not null,
  sim_tool_id integer not null
);

create table tool_config (
  tool_id text not null references tool (id),
  version integer not null,
  notes text not null,
  primary key (tool_id, version)
);

create table experiment (
  id text primary key,
  name text not null,
  goal text not null
);

create table recipe_version (
  tool_id text not null references tool (id),
  version integer not null,
  name text not null,
  steps jsonb not null,
  primary key (tool_id, version)
);

create table wafer (
  id text primary key,
  experiment_id text not null references experiment (id),
  pattern_file text not null,
  pattern_sha text not null
);

create table run (
  id text primary key,
  tool_id text not null references tool (id),
  run_idx integer not null,
  wafer_id text not null references wafer (id),
  tool_config_version integer not null,
  recipe_version integer not null,
  start_ms bigint not null,
  end_ms bigint,
  expected_frames integer,
  unique (tool_id, run_idx),
  foreign key (tool_id, tool_config_version) references tool_config (tool_id, version),
  foreign key (tool_id, recipe_version) references recipe_version (tool_id, version)
);

create table frame (
  run_id text not null references run (id),
  step_idx smallint not null,
  seq integer not null,
  t_ms bigint not null,
  heater_temp double precision not null,
  heater_power double precision not null,
  pressure double precision not null,
  gas_flow double precision not null
);
create index frame_t_brin on frame using brin (t_ms);
create index frame_run_t on frame (run_id, t_ms);

create table step_summary (
  run_id text not null references run (id),
  step_idx smallint not null,
  channel text not null,
  mean double precision not null,
  std double precision not null,
  n integer not null,
  expected_n integer not null,
  primary key (run_id, step_idx, channel)
);

create table health_features (
  run_id text primary key references run (id),
  p_dep double precision not null,
  k double precision not null,
  base_pressure double precision not null,
  sat_dep_s double precision not null
);

create table measurement (
  run_id text primary key references run (id),
  wafer_id text not null references wafer (id),
  thickness double precision not null,
  target double precision not null,
  spec_hw double precision not null
);
