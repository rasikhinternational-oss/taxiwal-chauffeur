-- =====================================================================
-- TAXI WAL — FEUILLES DE ROUTE : SÉCURITÉ + SUPPRESSION DÉFINITIVE + PURGE 15 JOURS
-- Supabase → SQL Editor → New query → coller TOUT ce fichier → Run
-- C'est LE SEUL fichier à coller (il remplace a-coller-securite.sql et a-coller-UNIQUE*.sql).
-- On peut le recoller sans danger : il ne crée rien en double.
--
-- Règles installées :
--  1. Feuille NON vérifiée ou NON « imprimée et classée » :
--       - JAMAIS supprimée automatiquement ;
--       - si l'administrateur la supprime, elle part dans la corbeille
--         (feuilles_supprimees + lignes_supprimees) pour pouvoir la recréer ;
--       - une feuille qui contient des courses ne peut être supprimée que par l'administrateur.
--  2. Feuille vérifiée (verifiee_admin) ET imprimée et classée (archivee_papier_at) :
--       - l'administrateur peut la supprimer DÉFINITIVEMENT à tout moment (aucune copie gardée) ;
--       - sinon elle est supprimée automatiquement et définitivement 15 jours après
--         la plus récente des deux dates (vérification / classement), chaque nuit à 02:10 UTC.
--  3. Les courses (table courses) ne sont JAMAIS effacées par la purge ni par la suppression définitive.
-- =====================================================================


-- ---------------------------------------------------------------------
-- A) Petite fonction utile : la feuille est-elle « vérifiée ET classée » ?
-- ---------------------------------------------------------------------
create or replace function public.feuille_verifiee_et_classee(f public.feuilles_route)
returns boolean language sql immutable set search_path to 'public' as $f$
  select coalesce(f.verifiee_admin, false) and f.archivee_papier_at is not null
$f$;


-- ---------------------------------------------------------------------
-- B) Garde + archive de l'en-tête de chaque feuille supprimée
--    (BEFORE DELETE sur feuilles_route)
-- ---------------------------------------------------------------------
create or replace function public.garder_feuille_supprimee()
returns trigger language plpgsql security definer set search_path to 'public' as $f$
declare
  v_nb integer;
  v_purge boolean := coalesce(current_setting('taxiwal.purge', true),'') in ('1','on');
  v_definitif boolean := coalesce(current_setting('taxiwal.definitif', true),'') = 'on';
begin
  select count(*) into v_nb from lignes_feuille_route where feuille_route_id = old.id;
  if v_nb > 0 and not v_purge and not public.is_admin() then
    raise exception 'SÉCURITÉ : cette feuille de route contient % course(s). Seule la centrale (administrateur) peut la supprimer.', v_nb
      using errcode = 'P0001';
  end if;
  -- Suppression définitive (feuille vérifiée ET classée) : aucune copie gardée
  if v_definitif and public.feuille_verifiee_et_classee(old) then
    return old;
  end if;
  -- Toutes les autres : copie dans la corbeille
  insert into feuilles_supprimees (par, par_nom, contexte, feuille_id, chauffeur_id, date_service, nb_lignes, feuille)
  values (auth.uid(), (select nom from profils where id = auth.uid()),
          case when v_purge then 'purge' when public.is_admin() then 'admin' else 'automatique (système)' end,
          old.id, old.chauffeur_id, old.date_service, v_nb, to_jsonb(old));
  return old;
end $f$;

create or replace trigger trg_000_garder_feuille_supprimee
  before delete on public.feuilles_route
  for each row execute function public.garder_feuille_supprimee();


-- ---------------------------------------------------------------------
-- C) Les courses ne sont pas effacées quand une feuille part en purge
--    ou en suppression définitive (même fonction qu'en direct + 1 ligne de sortie)
-- ---------------------------------------------------------------------
create or replace function public.supprimer_course_ligne_manuelle()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_course courses%rowtype;
  v_suppression_utilisateur boolean;
begin
  -- Purge 15 jours / suppression définitive : on ne touche JAMAIS aux courses
  if coalesce(current_setting('taxiwal.purge', true),'') in ('1','on') then return old; end if;

  if old.course_id is null then return old; end if;

  select * into v_course from courses where id = old.course_id;
  if v_course.id is null then return old; end if;

  -- Suppression voulue par un utilisateur :
  --  - ligne supprimée directement (profondeur 1)
  --  - ou feuille de route supprimée (la feuille n'existe plus), sauf si c'est le compte chauffeur qui est supprimé
  v_suppression_utilisateur :=
    pg_trigger_depth() = 1
    or (
      not exists (select 1 from feuilles_route where id = old.feuille_route_id)
      and (v_course.chauffeur_id is null or exists (select 1 from profils where id = v_course.chauffeur_id))
    );

  -- Lignes retirées automatiquement par le système (annulation, réattribution…) : la course est conservée
  if not v_suppression_utilisateur then return old; end if;

  perform set_config('taxiwal.sync', '1', true);
  -- Le retour éventuel est conservé (détaché de l'aller supprimé)
  update courses set course_aller_id = null where course_aller_id = v_course.id;
  -- Si on supprime un retour, l'aller ne doit pas le recréer
  if v_course.est_retour and v_course.course_aller_id is not null then
    update courses set aller_retour = false where id = v_course.course_aller_id;
  end if;
  delete from courses where id = v_course.id;
  perform set_config('taxiwal.sync', '', true);
  return old;
end $function$;
-- (Rappel : garder_ligne_supprimee, déjà en direct, laisse passer sans copie quand taxiwal.purge = on.)


-- ---------------------------------------------------------------------
-- D) Suppression par l'administrateur (bouton « Supprimer » + code)
--    - feuille vérifiée ET classée  → DÉFINITIVE (aucune copie, courses gardées)
--    - toute autre feuille          → corbeille (copie de la feuille et de ses lignes)
-- ---------------------------------------------------------------------
create or replace function public.admin_supprimer_feuille(p_feuille_id uuid, p_code text)
returns void language plpgsql security definer set search_path to 'public', 'extensions' as $function$
declare v_hash text; v_f feuilles_route;
begin
  if not is_admin() then raise exception 'Réservé à l''administrateur'; end if;
  select valeur into v_hash from parametres_admin where cle = 'code_suppression_feuille';
  if v_hash is null then raise exception 'Aucun code de suppression n''est encore défini'; end if;
  if p_code is null or crypt(trim(p_code), v_hash) <> v_hash then raise exception 'Code incorrect'; end if;

  select * into v_f from feuilles_route where id = p_feuille_id;
  if v_f.id is null then raise exception 'Feuille introuvable'; end if;

  if public.feuille_verifiee_et_classee(v_f) then
    perform set_config('taxiwal.purge', 'on', true);       -- lignes : pas de garde, pas de copie, courses gardées
    perform set_config('taxiwal.definitif', 'on', true);   -- feuille : pas de copie
  else
    perform set_config('taxiwal.suppression_admin', 'on', true);   -- corbeille (lignes archivées)
  end if;

  delete from feuilles_route where id = p_feuille_id;
  if not found then raise exception 'Feuille introuvable'; end if;

  perform set_config('taxiwal.purge', '', true);
  perform set_config('taxiwal.definitif', '', true);
  perform set_config('taxiwal.suppression_admin', '', true);
end $function$;


-- ---------------------------------------------------------------------
-- E) Purge automatique : feuilles vérifiées ET classées depuis plus de 15 jours
--    (15 jours comptés depuis la plus récente des deux dates). Définitive, sans copie.
-- ---------------------------------------------------------------------
create or replace function public.purger_feuilles_verifiees_classees()
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare v_nb integer;
begin
  perform set_config('taxiwal.purge', 'on', true);
  perform set_config('taxiwal.definitif', 'on', true);
  delete from feuilles_route f
   where coalesce(f.verifiee_admin, false) = true
     and f.archivee_papier_at is not null
     and greatest(f.verifiee_admin_a, f.archivee_papier_at) <= now() - interval '15 days';
  get diagnostics v_nb = row_count;
  perform set_config('taxiwal.purge', '', true);
  perform set_config('taxiwal.definitif', '', true);
  return v_nb;
end $function$;

-- Seul le système (tâche de nuit) peut lancer la purge, pas l'application
revoke all on function public.purger_feuilles_verifiees_classees() from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- F) Tâches de nuit (pg_cron) : on retire les 2 anciennes tâches inactives
--    et on programme la nouvelle purge chaque jour à 02:10 UTC
-- ---------------------------------------------------------------------
do $d$
begin
  if exists (select 1 from cron.job where jobname = 'purge-feuilles-verifiees') then
    perform cron.unschedule('purge-feuilles-verifiees');
  end if;
  if exists (select 1 from cron.job where jobname = 'supprimer-feuilles-vides') then
    perform cron.unschedule('supprimer-feuilles-vides');
  end if;
  if exists (select 1 from cron.job where jobname = 'purger-feuilles-verifiees-classees-15j') then
    perform cron.unschedule('purger-feuilles-verifiees-classees-15j');
  end if;
  perform cron.schedule('purger-feuilles-verifiees-classees-15j', '10 2 * * *',
                        'select public.purger_feuilles_verifiees_classees()');
end $d$;


-- ---------------------------------------------------------------------
-- G) CONTRÔLE (rien n'est supprimé ici) : tâches de nuit + simulation du jour
-- ---------------------------------------------------------------------
select 'tâche de nuit' as quoi, jobname as nom, schedule as horaire, active::text as active, '' as detail
  from cron.job
union all
select 'simulation purge aujourd''hui', 'feuilles qui SERAIENT supprimées', '-', '-',
       count(*)::text || ' feuille(s) sur ' ||
       (select count(*) from feuilles_route where public.feuille_verifiee_et_classee(feuilles_route))::text ||
       ' vérifiée(s) et classée(s)'
  from feuilles_route f
 where coalesce(f.verifiee_admin, false) = true
   and f.archivee_papier_at is not null
   and greatest(f.verifiee_admin_a, f.archivee_papier_at) <= now() - interval '15 days'
order by 1, 2;
