-- Схема облачного прогресса статического сайта.
--
-- Накатывается руками через SQL Editor в консоли Supabase. Механизма миграций
-- нет намеренно: таблиц три, проект один, а CLI Supabase потребовал бы
-- связанного локального Postgres ради трёх create table.
--
-- Анонимный ключ лежит открытым текстом в HTML — так устроен Supabase, ключ
-- публичен по замыслу. Защищает не он, а политики в конце файла: без них тот
-- же ключ отдаёт содержимое таблиц любому желающему.

-- Потолки на slug и id шага — по той же причине, что и у файлов упражнений
-- ниже: обе строки приходят от клиента, и без потолка строка весит сколько
-- угодно. 200 символов — с запасом на самый длинный slug курса.
create table if not exists step_progress (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null check (length(lesson_slug) < 200),
  step_id     text not null check (length(step_id) < 200),
  state       text not null check (state in ('read', 'failed', 'passed')),
  updated_at  timestamptz not null default now(),
  primary key (user_id, lesson_slug, step_id)
);

-- Потолок на размер файла — не косметика: регистрация открытая, ключ
-- публичный, и без него одна вкладка забивает бесплатные 500 МБ целиком.
-- 200 000 символов — два порядка сверх самого большого упражнения курса.
--
-- Потолки на slug и имя файла — про то же самое: обе строки клиент выбирает
-- сам, и без них строка весит не 200 КБ, а сколько угодно. 200 символов — с
-- запасом на самый длинный путь упражнения в курсе.
--
-- Чего эти потолки не дают, надо назвать прямо: числа строк они не
-- ограничивают. Первичный ключ (user_id, slug, file_name) позволяет одному
-- аккаунту завести сколько угодно пар «slug + имя файла», и потолок ограничивает
-- только цену одной строки. Верхняя оценка злого умысла — 500 МБ базы, делённые
-- на аккаунт, то есть весь проект целиком; защиты от того, кто заводит аккаунт
-- ради заливки мусора, здесь нет. Это принятая цена: курс читают по ссылке,
-- вход только через GitHub, а сторожевой триггер на счёт строк стоил бы запроса
-- к таблице на каждую вставку — и всё равно обходился бы вторым аккаунтом.
-- Настоящая защита от этого — квоты и мониторинг на стороне Supabase, а не
-- ограничение в схеме.
create table if not exists exercise_files (
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  slug       text not null check (length(slug) < 200),
  file_name  text not null check (length(file_name) < 200),
  content    text not null check (length(content) < 200000),
  updated_at timestamptz not null default now(),
  primary key (user_id, slug, file_name)
);

-- Только последний прогон каждого шага, а не история: истории прогонов в
-- интерфейсе сайта нет, а бесплатная база не то место, где копят журнал.
create table if not exists run_results (
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  lesson_slug text not null check (length(lesson_slug) < 200),
  step_id     text not null check (length(step_id) < 200),
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

-- Права на таблицы.
--
-- Политики RLS отвечают на вопрос «какие строки видно», но сначала роль должна
-- иметь право обратиться к таблице вообще. Этот проект Supabase не выдаёт такие
-- права новым таблицам сам, и без строк ниже даже вошедший читатель получает
-- «permission denied for table step_progress» — до политик дело не доходит.
--
-- Права выдаются только роли authenticated. Роль anon не получает ничего: к
-- этим таблицам обращается лишь вошедший читатель, и отказ на уровне привилегий
-- надёжнее отказа на уровне политики — он не зависит от того, не ошиблись ли мы
-- в условии.
grant select, insert, update, delete on step_progress  to authenticated;
grant select, insert, update, delete on exercise_files to authenticated;
grant select, insert, update, delete on run_results    to authenticated;

revoke all on step_progress  from anon;
revoke all on exercise_files from anon;
revoke all on run_results    from anon;
