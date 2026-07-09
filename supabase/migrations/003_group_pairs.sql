-- Pairs within a group: two members treated as one unit in the balance view
CREATE TABLE public.group_pairs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id_1   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  user_id_2   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id_1, user_id_2)
);

CREATE INDEX idx_group_pairs_group ON public.group_pairs(group_id);

ALTER TABLE public.group_pairs ENABLE ROW LEVEL SECURITY;

CREATE POLICY group_pairs_select ON public.group_pairs FOR SELECT
  USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY group_pairs_insert ON public.group_pairs FOR INSERT
  WITH CHECK (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY group_pairs_delete ON public.group_pairs FOR DELETE
  USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));
