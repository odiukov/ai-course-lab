-- Схема облачного прогресса статического сайта.
--
-- Накатывается руками через SQL Editor в консоли Supabase. Механизма миграций
-- нет намеренно: таблиц три, проект один, а CLI Supabase потребовал бы
-- связанного локального Postgres ради трёх create table.
--
-- Анонимный ключ лежит открытым текстом в HTML — так устроен Supabase, ключ
-- публичен по замыслу. Защищает не он, а политики в конце файла: без них тот
-- же ключ отдаёт содержимое таблиц любому желающему.

create table if not exists step_progress (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null,
  step_id     text not null,
  state       text not null check (state in ('read', 'failed', 'passed')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson_slug, step_id)
);

-- Потолок на размер файла — не косметика: регистрация открытая, ключ
-- публичный, и без него одна вкладка забивает бесплатные 500 МБ целиком.
-- 200 000 символов — два порядка сверх самого большого упражнения курса.
create table if not exists exercise_files (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  slug       text not null,
  file_name  text not null,
  content    text not null check (length(content) < 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, slug, file_name)
);

-- Только последний прогон каждого шага, а не история: истории прогонов в
-- интерфейсе сайта нет, а бесплатная база не то место, где копят журнал.
create table if not exists run_results (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null,
  step_id     text not null,
  passed      integer not null,
  failed      integer not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, lesson_slug, step_id)
);

alter table step_progress  enable row level security;
alter table exercise_files enable row level security;
alter table run_results    enable row level security;

drop policy if exists "own rows" on step_progress;
create policy "own rows" on step_progress
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on exercise_files;
create policy "own rows" on exercise_files
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on run_results;
create policy "own rows" on run_results
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
