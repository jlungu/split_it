import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMe, updateMe, resolvePersonInput } from '../lib/api';
import { supabase } from '../lib/supabase';
import { useContactsStore } from '../store/contacts';
import type { User } from '@split-it/types';

export default function Profile() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [form, setForm] = useState({ display_name: '', venmo_handle: '', zelle_contact: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { contacts, add: addContact, remove: removeContact } = useContactsStore();
  const [contactEmail, setContactEmail] = useState('');
  const [contactLoading, setContactLoading] = useState(false);
  const [contactError, setContactError] = useState('');

  async function handleAddContact(e: React.FormEvent) {
    e.preventDefault();
    const val = contactEmail.trim();
    if (!val) return;
    setContactLoading(true);
    setContactError('');
    try {
      const found = await resolvePersonInput(val);
      if (found.id === user?.id) { setContactError("That's you!"); return; }
      addContact(found);
      setContactEmail('');
    } catch {
      setContactError('Could not add person. Try again.');
    } finally {
      setContactLoading(false);
    }
  }

  useEffect(() => {
    getMe().then(({ user: u }) => {
      setUser(u);
      setForm({
        display_name: u.display_name ?? '',
        venmo_handle: u.venmo_handle ?? '',
        zelle_contact: u.zelle_contact ?? '',
      });
    }).finally(() => setLoading(false));
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { user: updated } = await updateMe({
        display_name: form.display_name || null,
        venmo_handle: form.venmo_handle || null,
        zelle_contact: form.zelle_contact || null,
      });
      setUser(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex h-screen items-center justify-center text-gray-400">Loading…</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-500 text-sm">← Back</button>
        <h1 className="font-semibold">Profile</h1>
      </div>

      <div className="px-4 pt-6 pb-28">
        <div className="card mb-4">
          <p className="text-xs text-gray-400 mb-1">Email</p>
          <p className="text-sm font-medium">{user?.email}</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="card space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500">Display name</label>
              <input
                className="input mt-1"
                value={form.display_name}
                onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                placeholder="Your name"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Venmo username</label>
              <div className="flex items-center mt-1">
                <span className="px-3 py-3 bg-gray-50 border border-r-0 border-gray-200 rounded-l-xl text-gray-400 text-sm">@</span>
                <input
                  className="input rounded-l-none border-l-0"
                  value={form.venmo_handle}
                  onChange={(e) => setForm({ ...form, venmo_handle: e.target.value.replace(/^@/, '') })}
                  placeholder="username"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500">Zelle (email or phone)</label>
              <input
                className="input mt-1"
                value={form.zelle_contact}
                onChange={(e) => setForm({ ...form, zelle_contact: e.target.value })}
                placeholder="email@example.com or +1 555 000 0000"
              />
            </div>
          </div>

          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved!' : 'Save'}
          </button>
        </form>

        {/* People */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3 px-1">People</h2>
          <div className="card space-y-3">
            <form onSubmit={handleAddContact} className="flex gap-2">
              <input
                className="input flex-1"
                type="text"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Name or email"
              />
              <button
                type="submit"
                disabled={contactLoading}
                className="px-4 py-2 bg-brand-600 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex-shrink-0"
              >
                {contactLoading ? '…' : 'Add'}
              </button>
            </form>
            {contactError && <p className="text-xs text-red-500">{contactError}</p>}
            {contacts.length === 0 ? (
              <p className="text-xs text-gray-400">No people saved yet. Add friends here to quickly assign them on receipts.</p>
            ) : (
              <ul className="space-y-2">
                {contacts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{c.display_name ?? c.email.split('@')[0]}</p>
                      <p className="text-xs text-gray-400">{c.email}</p>
                    </div>
                    <button
                      onClick={() => removeContact(c.id)}
                      className="text-gray-300 text-lg leading-none hover:text-red-400 transition-colors"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-8 space-y-3">
          {import.meta.env.DEV && (
            <button
              onClick={async () => {
                const { error } = await supabase.auth.updateUser({ password: 'splitit-dev' });
                alert(error ? `Error: ${error.message}` : 'Dev password set to "splitit-dev" ✓');
              }}
              className="btn-secondary text-amber-600 border-amber-200"
            >
              ⚡ Set dev password (local only)
            </button>
          )}
          <button
            onClick={() => supabase.auth.signOut().then(() => navigate('/login'))}
            className="btn-secondary text-red-500 border-red-100"
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
