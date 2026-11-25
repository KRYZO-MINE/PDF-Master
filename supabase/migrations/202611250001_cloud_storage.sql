create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  premium_status text not null default 'inactive' check (premium_status in ('inactive', 'active', 'grace')),
  premium_until timestamptz,
  quota_bytes bigint not null default 0 check (quota_bytes >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cloud_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  display_name text not null,
  size_bytes bigint not null check (size_bytes > 0),
  content_type text not null,
  status text not null default 'uploading' check (status in ('uploading', 'stored')),
  created_at timestamptz not null default now()
);

create index if not exists cloud_files_user_created_idx on public.cloud_files (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.cloud_files enable row level security;

grant select on public.profiles to authenticated;
grant select, delete on public.cloud_files to authenticated;

create or replace function public.handle_new_cloud_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_cloud_profile_after_signup on auth.users;
create trigger create_cloud_profile_after_signup
  after insert on auth.users
  for each row execute function public.handle_new_cloud_profile();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.user_can_upload_cloud(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.premium_status = 'active'
      and (p.premium_until is null or p.premium_until > now())
      and p.quota_bytes = 1073741824
  );
$$;

create or replace function public.user_can_read_cloud(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and (
        (p.premium_status = 'active' and (p.premium_until is null or p.premium_until > now()))
        or (p.premium_until is not null and p.premium_until + interval '30 days' > now())
      )
  );
$$;

create or replace function public.set_verified_premium_entitlement(
  p_user_id uuid,
  p_status text,
  p_premium_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Only a trusted server can update Premium entitlement.';
  end if;
  if p_status not in ('inactive', 'active', 'grace') then
    raise exception 'Invalid Premium status.';
  end if;

  update public.profiles
  set premium_status = p_status,
      premium_until = p_premium_until,
      quota_bytes = case when p_status in ('active', 'grace') then 1073741824 else 0 end,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'The Premium account does not exist.';
  end if;
end;
$$;

revoke all on function public.user_can_upload_cloud(uuid) from public, anon;
revoke all on function public.user_can_read_cloud(uuid) from public, anon;
revoke all on function public.set_verified_premium_entitlement(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.user_can_upload_cloud(uuid) to authenticated;
grant execute on function public.user_can_read_cloud(uuid) to authenticated;
grant execute on function public.set_verified_premium_entitlement(uuid, text, timestamptz) to service_role;

create policy "Profiles are readable by their owner"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "Cloud files are readable during paid access or grace"
  on public.cloud_files for select to authenticated
  using (
    user_id = (select auth.uid())
    and public.user_can_read_cloud((select auth.uid()))
  );

create policy "Owners can delete their cloud file metadata"
  on public.cloud_files for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.reserve_cloud_upload(
  p_display_name text,
  p_size_bytes bigint,
  p_content_type text
)
returns table (id uuid, storage_path text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.profiles%rowtype;
  v_used_bytes bigint;
  v_file_id uuid := gen_random_uuid();
  v_path text;
begin
  if v_user_id is null then
    raise exception 'Sign in is required to upload cloud files.';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 then
    raise exception 'The selected file is empty or has an invalid size.';
  end if;
  if p_display_name is null or length(trim(p_display_name)) = 0 or length(p_display_name) > 240 then
    raise exception 'The selected file name is invalid.';
  end if;
  if p_content_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') then
    raise exception 'Only PDF, JPG, PNG, and WEBP files are supported.';
  end if;

  select * into v_profile from public.profiles where profiles.id = v_user_id for update;
  if not found or not public.user_can_upload_cloud(v_user_id) then
    raise exception 'An active, verified Premium account is required to upload.';
  end if;

  select coalesce(sum(f.size_bytes), 0) into v_used_bytes
  from public.cloud_files f
  where f.user_id = v_user_id;

  if v_used_bytes + p_size_bytes > v_profile.quota_bytes then
    raise exception 'This upload exceeds your available 1 GB cloud storage.';
  end if;

  v_path := v_user_id::text || '/' || v_file_id::text;
  insert into public.cloud_files (id, user_id, storage_path, display_name, size_bytes, content_type, status)
  values (v_file_id, v_user_id, v_path, p_display_name, p_size_bytes, p_content_type, 'uploading');

  return query select v_file_id, v_path;
end;
$$;

create or replace function public.finalize_cloud_upload(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cloud_files
  set status = 'stored'
  where id = p_file_id
    and user_id = auth.uid()
    and status = 'uploading'
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'pdf-master-cloud'
        and o.name = cloud_files.storage_path
        and o.metadata->>'size' = cloud_files.size_bytes::text
    );

  if not found then
    raise exception 'The cloud upload reservation is missing or no longer valid.';
  end if;
end;
$$;

create or replace function public.release_cloud_upload(p_file_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.cloud_files
  where id = p_file_id
    and user_id = auth.uid()
    and status = 'uploading';
$$;

revoke all on function public.reserve_cloud_upload(text, bigint, text) from public, anon;
revoke all on function public.finalize_cloud_upload(uuid) from public, anon;
revoke all on function public.release_cloud_upload(uuid) from public, anon;
grant execute on function public.reserve_cloud_upload(text, bigint, text) to authenticated;
grant execute on function public.finalize_cloud_upload(uuid) to authenticated;
grant execute on function public.release_cloud_upload(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdf-master-cloud', 'pdf-master-cloud', false, 1073741824, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = 1073741824,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

create policy "Premium users can upload reserved cloud files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'pdf-master-cloud'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.user_can_upload_cloud((select auth.uid()))
    and exists (
      select 1 from public.cloud_files f
      where f.storage_path = name
        and f.user_id = (select auth.uid())
        and f.status = 'uploading'
        and f.size_bytes::text = metadata->>'size'
    )
  );

create policy "Owners can read stored cloud files during access period"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'pdf-master-cloud'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.user_can_read_cloud((select auth.uid()))
    and exists (
      select 1 from public.cloud_files f
      where f.storage_path = name
        and f.user_id = (select auth.uid())
        and f.status = 'stored'
    )
  );

create policy "Owners can delete their cloud files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'pdf-master-cloud'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
