-- Permite que a Edge Function manage-user sincronize o perfil do usuário criado.
grant select, update on table public.profiles to service_role;
