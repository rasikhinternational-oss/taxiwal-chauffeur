-- Taxi Wal : partenaires (sous-traitance) — migration additive
-- 1) Demandes de partenariat
create table if not exists public.demandes_partenariat (
  id uuid primary key default gen_random_uuid(),
  statut text not null default 'en_attente' check (statut in ('en_attente','active','refusee')),
  responsable_nom text not null,
  responsable_telephone text,
  responsable_email text not null,
  societe_nom text not null,
  bce_tva text,
  adresse text,
  iban text,
  chauffeurs jsonb not null default '[]'::jsonb,
  vehicules jsonb not null default '[]'::jsonb,
  partenaire_id uuid references public.profils(id),
  motif_refus text,
  created_at timestamptz not null default now(),
  traite_at timestamptz
);
alter table public.demandes_partenariat enable row level security;
drop policy if exists "admin gere les demandes de partenariat" on public.demandes_partenariat;
create policy "admin gere les demandes de partenariat" on public.demandes_partenariat
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "partenaire voit sa demande" on public.demandes_partenariat;
create policy "partenaire voit sa demande" on public.demandes_partenariat
  for select using (partenaire_id = auth.uid());

-- 2) Publications de courses aux partenaires
create table if not exists public.publications_partenaires (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  partenaire_id uuid not null references public.profils(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (course_id, partenaire_id)
);
alter table public.publications_partenaires enable row level security;
drop policy if exists "admin gere les publications" on public.publications_partenaires;
create policy "admin gere les publications" on public.publications_partenaires
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "partenaire voit ses publications" on public.publications_partenaires;
create policy "partenaire voit ses publications" on public.publications_partenaires
  for select using (partenaire_id = auth.uid());

-- 3) Offres de prix des partenaires
create table if not exists public.offres_partenaires (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  partenaire_id uuid not null references public.profils(id) on delete cascade,
  prix_partenaire numeric(10,2) not null check (prix_partenaire > 0),
  prix_client numeric(10,2),
  type_vehicule text,
  message text,
  statut text not null default 'proposee' check (statut in ('proposee','ecartee','envoyee','choisie','refusee')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, partenaire_id)
);
alter table public.offres_partenaires enable row level security;
drop policy if exists "admin gere les offres" on public.offres_partenaires;
create policy "admin gere les offres" on public.offres_partenaires
  for all using (public.is_admin()) with check (public.is_admin());
-- le partenaire lit ses offres (écritures uniquement via fonctions)
drop policy if exists "partenaire voit ses offres" on public.offres_partenaires;
create policy "partenaire voit ses offres" on public.offres_partenaires
  for select using (partenaire_id = auth.uid());

-- 4) Règlements mensuels
create table if not exists public.reglements_partenaires (
  id uuid primary key default gen_random_uuid(),
  partenaire_id uuid not null references public.profils(id) on delete cascade,
  mois date not null,
  nb_courses integer not null default 0,
  solde numeric(10,2) not null default 0,
  regle_at timestamptz not null default now(),
  regle_par uuid,
  unique (partenaire_id, mois)
);
alter table public.reglements_partenaires enable row level security;
drop policy if exists "admin gere les reglements" on public.reglements_partenaires;
create policy "admin gere les reglements" on public.reglements_partenaires
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "partenaire voit ses reglements" on public.reglements_partenaires;
create policy "partenaire voit ses reglements" on public.reglements_partenaires
  for select using (partenaire_id = auth.uid());

-- 5) Attribution d'une course à un partenaire (prix partenaire hors de la table courses : le client ne le voit jamais)
alter table public.courses add column if not exists offres_partenaires_envoyees boolean not null default false;
create table if not exists public.attributions_partenaires (
  course_id uuid primary key references public.courses(id) on delete cascade,
  partenaire_id uuid not null references public.profils(id),
  offre_id uuid references public.offres_partenaires(id) on delete set null,
  prix_partenaire numeric(10,2) not null,
  created_at timestamptz not null default now()
);
create index if not exists attributions_partenaires_partenaire_idx on public.attributions_partenaires(partenaire_id);
alter table public.attributions_partenaires enable row level security;
drop policy if exists "admin gere les attributions" on public.attributions_partenaires;
create policy "admin gere les attributions" on public.attributions_partenaires
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "partenaire voit ses attributions" on public.attributions_partenaires;
create policy "partenaire voit ses attributions" on public.attributions_partenaires
  for select using (partenaire_id = auth.uid());

-- 6) Un client ne lit jamais le profil d'un partenaire (politique restrictive ajoutée)
create or replace function public.est_client_simple()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profils where id = auth.uid() and role = 'client');
$$;
drop policy if exists "client ne voit jamais un partenaire" on public.profils;
create policy "client ne voit jamais un partenaire" on public.profils
  as restrictive for select
  using (role is distinct from 'partenaire' or id = auth.uid() or not public.est_client_simple());

-- 7) Stockage des documents (bucket privé)
insert into storage.buckets (id, name, public) values ('documents-partenaires','documents-partenaires', false)
  on conflict (id) do nothing;

create or replace function public.demande_partenariat_ouverte(p_id text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from demandes_partenariat
                 where id::text = p_id and statut = 'en_attente' and created_at > now() - interval '3 hours');
$$;
drop policy if exists "depot documents demande partenariat" on storage.objects;
create policy "depot documents demande partenariat" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'documents-partenaires'
              and (storage.foldername(name))[1] = 'demandes'
              and public.demande_partenariat_ouverte((storage.foldername(name))[2]));
drop policy if exists "admin lit documents partenaires" on storage.objects;
create policy "admin lit documents partenaires" on storage.objects
  for select to authenticated using (bucket_id = 'documents-partenaires' and public.is_admin());

-- 8) Dépôt d'une demande (accessible sans compte)
create or replace function public.deposer_demande_partenariat(
  p_responsable_nom text, p_responsable_telephone text, p_responsable_email text,
  p_societe_nom text, p_bce_tva text, p_adresse text, p_iban text,
  p_chauffeurs jsonb, p_vehicules jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_admin record;
begin
  if coalesce(trim(p_responsable_nom),'') = '' or coalesce(trim(p_societe_nom),'') = ''
     or coalesce(trim(p_responsable_email),'') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Nom du responsable, société et adresse e-mail valide sont obligatoires';
  end if;
  if (select count(*) from demandes_partenariat where lower(responsable_email) = lower(trim(p_responsable_email))
        and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Trop de demandes envoyées avec cette adresse. Réessaie demain.';
  end if;
  insert into demandes_partenariat (responsable_nom, responsable_telephone, responsable_email, societe_nom,
    bce_tva, adresse, iban, chauffeurs, vehicules)
  values (left(trim(p_responsable_nom),120), left(nullif(trim(p_responsable_telephone),''),40),
    lower(left(trim(p_responsable_email),160)), left(trim(p_societe_nom),160),
    left(nullif(trim(p_bce_tva),''),40), left(nullif(trim(p_adresse),''),300), left(nullif(trim(p_iban),''),40),
    case when jsonb_typeof(p_chauffeurs) = 'array' then p_chauffeurs else '[]'::jsonb end,
    case when jsonb_typeof(p_vehicules) = 'array' then p_vehicules else '[]'::jsonb end)
  returning id into v_id;
  for v_admin in select id from profils where role = 'admin' loop
    insert into notifications (chauffeur_id, course_id, type, message)
    values (v_admin.id, null, 'demande_partenariat',
      '🤝 Nouvelle demande de partenariat : ' || trim(p_societe_nom) || ' (' || trim(p_responsable_nom) ||
      '). À voir dans Partenaires → Demandes de partenariat.');
  end loop;
  return v_id;
end $$;
revoke all on function public.deposer_demande_partenariat(text,text,text,text,text,text,text,jsonb,jsonb) from public;
grant execute on function public.deposer_demande_partenariat(text,text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;

-- 9) Admin : activer / refuser
create or replace function public.admin_activer_demande_partenariat(p_demande uuid, p_taux numeric default 10)
returns uuid language plpgsql security definer set search_path = public, auth as $$
declare v_d demandes_partenariat; v_uid uuid;
begin
  if not is_admin() then raise exception 'Non autorisé'; end if;
  select * into v_d from demandes_partenariat where id = p_demande;
  if v_d.id is null then raise exception 'Demande introuvable'; end if;
  select id into v_uid from auth.users where lower(email) = lower(v_d.responsable_email) limit 1;
  if v_uid is null then raise exception 'Compte de connexion introuvable pour %', v_d.responsable_email; end if;
  update profils set role = 'partenaire', actif = true,
    taux_commission = coalesce(p_taux, 10), societe = v_d.societe_nom,
    nom = coalesce(nullif(nom,''), v_d.responsable_nom),
    telephone = coalesce(nullif(telephone,''), v_d.responsable_telephone)
  where id = v_uid and role in ('partenaire','client');
  if not found then
    if exists (select 1 from profils where id = v_uid) then
      raise exception 'Ce compte existe déjà avec un autre rôle (chauffeur/admin)';
    end if;
    insert into profils (id, role, nom, telephone, actif, taux_commission, societe)
    values (v_uid, 'partenaire', v_d.responsable_nom, v_d.responsable_telephone, true, coalesce(p_taux,10), v_d.societe_nom);
  end if;
  update demandes_partenariat set statut = 'active', partenaire_id = v_uid, traite_at = now(), motif_refus = null
  where id = p_demande;
  return v_uid;
end $$;

create or replace function public.admin_refuser_demande_partenariat(p_demande uuid, p_motif text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Non autorisé'; end if;
  update demandes_partenariat set statut = 'refusee', motif_refus = left(nullif(trim(p_motif),''),500), traite_at = now()
  where id = p_demande;
end $$;

-- 10) Admin : publier une course à un ou plusieurs partenaires
create or replace function public.admin_publier_course_partenaires(p_course uuid, p_partenaires uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v_c courses; v_p uuid; v_n integer := 0;
begin
  if not is_admin() then raise exception 'Non autorisé'; end if;
  select * into v_c from courses where id = p_course;
  if v_c.id is null then raise exception 'Course introuvable'; end if;
  if v_c.chauffeur_id is not null then raise exception 'Cette course est déjà attribuée'; end if;
  foreach v_p in array coalesce(p_partenaires, '{}') loop
    if exists (select 1 from profils where id = v_p and role = 'partenaire' and actif) then
      insert into publications_partenaires (course_id, partenaire_id) values (p_course, v_p)
        on conflict do nothing;
      if found then
        v_n := v_n + 1;
        insert into notifications (chauffeur_id, course_id, type, message)
        values (v_p, p_course, 'course_partenaire',
          '📢 Nouvelle course proposée : ' || coalesce(v_c.adresse_depart,'?') || ' → ' || coalesce(v_c.adresse_arrivee,'?') ||
          ' le ' || to_char(v_c.date_heure at time zone 'Europe/Brussels', 'DD/MM à HH24:MI') || '. Fais ton offre de prix dans l''app.');
      end if;
    end if;
  end loop;
  return v_n;
end $$;

-- 11) Partenaire : courses publiées pour lui (sans données client)
create or replace function public.partenaire_courses_publiees()
returns table (course_id uuid, date_heure timestamptz, adresse_depart text, adresse_arrivee text,
  passagers integer, bagages integer, vehicule_souhaite text, aller_retour boolean,
  mon_prix numeric, mon_type_vehicule text, mon_statut text)
language sql stable security definer set search_path = public as $$
  select c.id, c.date_heure, c.adresse_depart, c.adresse_arrivee, c.passagers, c.bagages, c.vehicule_souhaite,
         c.aller_retour, o.prix_partenaire, o.type_vehicule, o.statut
  from publications_partenaires pp
  join courses c on c.id = pp.course_id
  join profils me on me.id = auth.uid() and me.role = 'partenaire' and me.actif
  left join offres_partenaires o on o.course_id = c.id and o.partenaire_id = auth.uid()
  where pp.partenaire_id = auth.uid()
    and c.chauffeur_id is null and c.statut not in ('annulee','terminee')
    and coalesce(o.statut,'proposee') not in ('ecartee','refusee')
    and not exists (select 1 from offres_partenaires x where x.course_id = c.id and x.statut = 'choisie')
  order by c.date_heure;
$$;

create or replace function public.partenaire_faire_offre(p_course uuid, p_prix numeric, p_type_vehicule text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare v_c courses; v_nom text; v_admin record; v_ex offres_partenaires;
begin
  if not exists (select 1 from profils where id = auth.uid() and role = 'partenaire' and actif) then
    raise exception 'Réservé aux partenaires actifs';
  end if;
  if p_prix is null or p_prix <= 0 or p_prix > 5000 then raise exception 'Prix invalide'; end if;
  if not exists (select 1 from publications_partenaires where course_id = p_course and partenaire_id = auth.uid()) then
    raise exception 'Course non disponible';
  end if;
  select * into v_c from courses where id = p_course;
  if v_c.id is null or v_c.chauffeur_id is not null or v_c.statut in ('annulee','terminee') then
    raise exception 'Cette course n''est plus disponible';
  end if;
  select * into v_ex from offres_partenaires where course_id = p_course and partenaire_id = auth.uid();
  if v_ex.id is not null and v_ex.statut <> 'proposee' then
    raise exception 'Ton offre a déjà été traitée, elle ne peut plus être modifiée';
  end if;
  insert into offres_partenaires (course_id, partenaire_id, prix_partenaire, type_vehicule, message)
  values (p_course, auth.uid(), round(p_prix,2), left(nullif(trim(p_type_vehicule),''),60), left(nullif(trim(p_message),''),300))
  on conflict (course_id, partenaire_id) do update
    set prix_partenaire = excluded.prix_partenaire, type_vehicule = excluded.type_vehicule,
        message = excluded.message, updated_at = now();
  select coalesce(societe, nom) into v_nom from profils where id = auth.uid();
  for v_admin in select id from profils where role = 'admin' loop
    insert into notifications (chauffeur_id, course_id, type, message)
    values (v_admin.id, p_course, 'offre_partenaire',
      '💶 Offre de ' || coalesce(v_nom,'un partenaire') || ' : ' || to_char(round(p_prix,2), 'FM999990.00') || ' € pour ' ||
      coalesce(v_c.adresse_depart,'?') || ' → ' || coalesce(v_c.adresse_arrivee,'?') || '.');
  end loop;
end $$;

-- 12) Admin : envoyer les offres retenues au client
-- p_offres = [{"id": "...", "prix_client": 49.5}, ...]
create or replace function public.admin_envoyer_offres_client(p_course uuid, p_offres jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare v_c courses; v_e jsonb; v_n integer := 0; v_ids uuid[] := '{}';
begin
  if not is_admin() then raise exception 'Non autorisé'; end if;
  select * into v_c from courses where id = p_course;
  if v_c.id is null or v_c.chauffeur_id is not null then raise exception 'Course non disponible'; end if;
  for v_e in select * from jsonb_array_elements(coalesce(p_offres,'[]'::jsonb)) loop
    if (v_e->>'prix_client')::numeric is null or (v_e->>'prix_client')::numeric <= 0 then
      raise exception 'Prix client invalide';
    end if;
    update offres_partenaires set prix_client = round((v_e->>'prix_client')::numeric, 2), statut = 'envoyee', updated_at = now()
    where id = (v_e->>'id')::uuid and course_id = p_course and statut in ('proposee','envoyee');
    if found then v_n := v_n + 1; v_ids := v_ids || (v_e->>'id')::uuid; end if;
  end loop;
  if v_n = 0 then raise exception 'Aucune offre à envoyer'; end if;
  update offres_partenaires set statut = 'ecartee', updated_at = now()
  where course_id = p_course and statut = 'envoyee' and not (id = any(v_ids));
  update courses set offres_partenaires_envoyees = true where id = p_course;
  if v_c.client_id is not null then
    insert into notifications (chauffeur_id, course_id, type, message)
    values (v_c.client_id, p_course, 'offres_client',
      'Taxi Wal : ' || v_n || ' proposition(s) de prix pour ta course du ' ||
      to_char(v_c.date_heure at time zone 'Europe/Brussels', 'DD/MM à HH24:MI') || '. Ouvre l''app pour choisir.');
  end if;
  return v_n;
end $$;

-- 13) Client : voir et choisir les offres (sous le nom Taxi Wal uniquement)
create or replace function public.client_offres_taxiwal(p_course uuid)
returns table (offre_id uuid, type_vehicule text, prix numeric)
language sql stable security definer set search_path = public as $$
  select o.id, coalesce(o.type_vehicule, 'Véhicule standard'), o.prix_client
  from offres_partenaires o join courses c on c.id = o.course_id
  where o.course_id = p_course and c.client_id = auth.uid() and c.chauffeur_id is null
    and c.statut not in ('annulee','terminee') and o.statut = 'envoyee' and o.prix_client is not null
  order by o.prix_client;
$$;

create or replace function public.client_choisir_offre_taxiwal(p_offre uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_o offres_partenaires; v_c courses;
begin
  select * into v_o from offres_partenaires where id = p_offre for update;
  if v_o.id is null or v_o.statut <> 'envoyee' then raise exception 'Cette proposition n''est plus disponible'; end if;
  select * into v_c from courses where id = v_o.course_id for update;
  if v_c.client_id is distinct from auth.uid() then raise exception 'Non autorisé'; end if;
  if v_c.chauffeur_id is not null or v_c.statut in ('annulee','terminee') then
    raise exception 'Cette course n''est plus disponible';
  end if;
  update offres_partenaires set statut = 'choisie', updated_at = now() where id = v_o.id;
  update offres_partenaires set statut = 'refusee', updated_at = now()
    where course_id = v_o.course_id and id <> v_o.id and statut in ('proposee','envoyee','ecartee');
  insert into attributions_partenaires (course_id, partenaire_id, offre_id, prix_partenaire)
  values (v_c.id, v_o.partenaire_id, v_o.id, v_o.prix_partenaire)
  on conflict (course_id) do update set partenaire_id = excluded.partenaire_id, offre_id = excluded.offre_id,
    prix_partenaire = excluded.prix_partenaire, created_at = now();
  update courses set chauffeur_id = v_o.partenaire_id, prix = v_o.prix_client, prix_client = v_o.prix_client,
    ouverte_marche = false, statut = 'assignee'
  where id = v_c.id;
end $$;

-- 14) Portefeuille
-- montant > 0 : Taxi Wal doit au partenaire ; montant < 0 : le partenaire doit à Taxi Wal
create or replace function public.montant_portefeuille_course(p_mode text, p_prix numeric, p_prix_partenaire numeric)
returns numeric language sql immutable set search_path = public as $$
  select case
    when p_prix_partenaire is null then 0
    when p_mode in ('cash','uber_cash') then -round(coalesce(p_prix,0) - p_prix_partenaire, 2)
    else p_prix_partenaire end;
$$;

-- Vue partenaire : jamais le pourcentage de commission
create or replace function public.partenaire_portefeuille(p_debut timestamptz default null, p_fin timestamptz default null)
returns table (course_id uuid, date_heure timestamptz, adresse_depart text, adresse_arrivee text, statut text,
  en_cash boolean, paiement_connu boolean, prix_partenaire numeric, a_encaisser numeric, montant numeric, regle boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.date_heure, c.adresse_depart, c.adresse_arrivee, c.statut,
    coalesce(c.mode_paiement in ('cash','uber_cash'), false),
    (c.mode_paiement is not null or coalesce(c.paye_en_ligne_montant,0) > 0),
    a.prix_partenaire,
    case when c.mode_paiement in ('cash','uber_cash') then coalesce(c.prix,0) + coalesce(c.surprime,0) end,
    montant_portefeuille_course(c.mode_paiement, c.prix, a.prix_partenaire),
    exists (select 1 from reglements_partenaires r where r.partenaire_id = a.partenaire_id
            and r.mois = date_trunc('month', c.date_heure at time zone 'Europe/Brussels')::date)
  from attributions_partenaires a
  join courses c on c.id = a.course_id and c.chauffeur_id = a.partenaire_id
  join profils me on me.id = auth.uid() and me.role = 'partenaire'
  where a.partenaire_id = auth.uid() and c.statut <> 'annulee'
    and (p_debut is null or c.date_heure >= p_debut) and (p_fin is null or c.date_heure < p_fin)
  order by c.date_heure desc;
$$;

create or replace function public.admin_regler_mois_partenaire(p_partenaire uuid, p_mois date)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_debut timestamptz; v_fin timestamptz; v_solde numeric; v_n integer;
begin
  if not is_admin() then raise exception 'Non autorisé'; end if;
  v_debut := (date_trunc('month', p_mois)::date)::timestamp at time zone 'Europe/Brussels';
  v_fin := ((date_trunc('month', p_mois) + interval '1 month')::date)::timestamp at time zone 'Europe/Brussels';
  select coalesce(sum(montant_portefeuille_course(c.mode_paiement, c.prix, a.prix_partenaire)),0), count(*) into v_solde, v_n
  from attributions_partenaires a join courses c on c.id = a.course_id and c.chauffeur_id = a.partenaire_id
  where a.partenaire_id = p_partenaire and c.statut = 'terminee'
    and c.date_heure >= v_debut and c.date_heure < v_fin;
  insert into reglements_partenaires (partenaire_id, mois, nb_courses, solde, regle_par)
  values (p_partenaire, date_trunc('month', p_mois)::date, v_n, v_solde, auth.uid())
  on conflict (partenaire_id, mois) do update set nb_courses = excluded.nb_courses, solde = excluded.solde,
    regle_at = now(), regle_par = excluded.regle_par;
  return v_solde;
end $$;

-- Droits d'exécution
do $$ declare f text; begin
  foreach f in array array[
    'admin_activer_demande_partenariat(uuid,numeric)','admin_refuser_demande_partenariat(uuid,text)',
    'admin_publier_course_partenaires(uuid,uuid[])','partenaire_courses_publiees()',
    'partenaire_faire_offre(uuid,numeric,text,text)','admin_envoyer_offres_client(uuid,jsonb)',
    'client_offres_taxiwal(uuid)','client_choisir_offre_taxiwal(uuid)',
    'partenaire_portefeuille(timestamptz,timestamptz)','admin_regler_mois_partenaire(uuid,date)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
end $$;
grant execute on function public.demande_partenariat_ouverte(text) to anon, authenticated;
