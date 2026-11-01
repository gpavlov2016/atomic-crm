create table public.gmail_connections (
    sales_id bigint not null primary key,
    google_email text not null,
    google_sub text not null,
    scopes text[] not null,
    refresh_token_ciphertext text not null,
    access_token_ciphertext text,
    access_token_expires_at timestamp with time zone,
    connected_at timestamp with time zone not null default now(),
    updated_at timestamp with time zone not null default now()
);

alter table public.gmail_connections
    add constraint gmail_connections_sales_id_fkey
    foreign key (sales_id) references public.sales(id) on delete cascade;

alter table public.gmail_connections enable row level security;

revoke all on table public.gmail_connections from public;
revoke all on table public.gmail_connections from anon;
revoke all on table public.gmail_connections from authenticated;
grant all on table public.gmail_connections to service_role;

create or replace view public.gmail_connection_status
with (security_invoker = off, security_barrier = on) as
select
    gc.sales_id,
    gc.google_email,
    gc.connected_at
from public.gmail_connections gc
    inner join public.sales s on s.id = gc.sales_id
where s.user_id = auth.uid();

revoke all on table public.gmail_connection_status from public;
revoke all on table public.gmail_connection_status from anon;
revoke all on table public.gmail_connection_status from authenticated;
grant select on table public.gmail_connection_status to authenticated;
grant all on table public.gmail_connection_status to service_role;
