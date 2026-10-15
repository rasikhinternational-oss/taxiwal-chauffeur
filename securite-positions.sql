-- À exécuter dans Supabase (SQL Editor) AU MOMENT où les nouveaux client.html / app.html sont mis sur GitHub.
-- Ferme l'accès des clients à la position des chauffeurs en dehors de l'approche.

create or replace function public.chauffeur_proposant_a_proximite(p_course_id uuid, p_chauffeur_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from courses c
    join propositions_courses pc on pc.course_id = c.id and pc.chauffeur_id = p_chauffeur_id
    join positions_chauffeurs p on p.chauffeur_id = p_chauffeur_id
    where c.id = p_course_id and auth.uid() is not null and c.client_id = auth.uid()
      and p.updated_at > now() - interval '15 minutes');
$$;
revoke execute on function public.chauffeur_proposant_a_proximite(uuid, uuid) from public, anon;
grant execute on function public.chauffeur_proposant_a_proximite(uuid, uuid) to authenticated;
drop policy "client voit la position du chauffeur de sa course" on public.positions_chauffeurs;
drop policy "client voit position des chauffeurs proposants" on public.positions_chauffeurs;

-- Retour arrière (si besoin) :
-- CREATE POLICY "client voit la position du chauffeur de sa course" ON public.positions_chauffeurs AS PERMISSIVE FOR SELECT TO public
--   USING (EXISTS (SELECT 1 FROM courses WHERE courses.chauffeur_id = positions_chauffeurs.chauffeur_id AND courses.client_id = auth.uid() AND courses.statut = ANY (ARRAY['assignee'::text,'en_cours'::text])));
-- CREATE POLICY "client voit position des chauffeurs proposants" ON public.positions_chauffeurs AS PERMISSIVE FOR SELECT TO public
--   USING (EXISTS (SELECT 1 FROM propositions_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.chauffeur_id = positions_chauffeurs.chauffeur_id AND c.client_id = auth.uid()));
