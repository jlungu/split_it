import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@split-it/types';

interface ContactsState {
  contacts: User[];
  add: (user: User) => void;
  remove: (userId: string) => void;
  update: (user: User) => void;
}

export const useContactsStore = create<ContactsState>()(
  persist(
    (set) => ({
      contacts: [],
      add: (user) => set((s) => ({
        contacts: s.contacts.find((c) => c.id === user.id) ? s.contacts : [...s.contacts, user],
      })),
      remove: (userId) => set((s) => ({ contacts: s.contacts.filter((c) => c.id !== userId) })),
      update: (user) => set((s) => ({ contacts: s.contacts.map((c) => c.id === user.id ? user : c) })),
    }),
    { name: 'split-it-contacts' }
  )
);
