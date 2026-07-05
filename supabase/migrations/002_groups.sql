-- Groups table
CREATE TABLE public.groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Group members junction table
CREATE TABLE public.group_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);

-- Add group_id to receipts (nullable — receipts don't have to belong to a group)
ALTER TABLE public.receipts ADD COLUMN group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_group_members_group ON public.group_members(group_id);
CREATE INDEX idx_group_members_user  ON public.group_members(user_id);
CREATE INDEX idx_receipts_group      ON public.receipts(group_id);

-- RLS (API uses service_role and bypasses these, but kept for defence-in-depth)
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY groups_member_select ON public.groups FOR SELECT
  USING (id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY groups_creator_insert ON public.groups FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY groups_creator_modify ON public.groups FOR UPDATE
  USING (created_by = auth.uid());

CREATE POLICY groups_creator_delete ON public.groups FOR DELETE
  USING (created_by = auth.uid());

CREATE POLICY group_members_select ON public.group_members FOR SELECT
  USING (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY group_members_insert ON public.group_members FOR INSERT
  WITH CHECK (group_id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid()));

CREATE POLICY group_members_delete ON public.group_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR group_id IN (SELECT id FROM public.groups WHERE created_by = auth.uid())
  );
