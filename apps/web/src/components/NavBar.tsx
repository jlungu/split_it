import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

const tabs = [
  {
    to: '/',
    label: 'Home',
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
      </svg>
    ),
  },
  {
    to: '/profile',
    label: 'Profile',
    icon: (active: boolean) => (
      <svg className="w-6 h-6" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
      </svg>
    ),
  },
];

export default function NavBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) navigate('/receipts/new', { state: { file } });
    e.target.value = '';
    setMenuOpen(false);
  }

  return (
    <>
      {/* Backdrop */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* Submenu */}
      {menuOpen && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-30 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden"
          style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="px-4 py-2.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add Receipt</p>
          </div>
          <button
            className="w-full px-4 py-3 text-sm font-medium text-gray-800 text-left active:bg-gray-50"
            onClick={() => { fileRef.current?.click(); }}
          >
            📷 From Photo
          </button>
          <button
            className="w-full px-4 py-3 text-sm font-medium text-gray-800 text-left active:bg-gray-50 border-t border-gray-100"
            onClick={() => {
              setMenuOpen(false);
              navigate('/receipts/new', { state: { manual: true } });
            }}
          >
            ✏️ Enter Manually
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handlePhotoSelected}
      />

      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-100 pb-safe">
        <div className="flex items-center justify-around h-16 max-w-lg mx-auto px-6">
          {/* Home tab */}
          <Link
            to="/"
            className={`flex flex-col items-center gap-0.5 flex-1 transition-colors ${
              location.pathname === '/' ? 'text-brand-600' : 'text-gray-400'
            }`}
            onClick={() => setMenuOpen(false)}
          >
            {tabs[0].icon(location.pathname === '/')}
            <span className="text-[10px] font-medium">Home</span>
          </Link>

          {/* Centre FAB */}
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="w-14 h-14 -mt-6 rounded-full bg-brand-600 text-white shadow-lg shadow-brand-600/30
              flex items-center justify-center active:bg-brand-700 transition-colors flex-shrink-0"
            aria-label="New receipt"
          >
            <svg
              className={`w-7 h-7 transition-transform duration-200 ${menuOpen ? 'rotate-45' : ''}`}
              fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>

          {/* Profile tab */}
          <Link
            to="/profile"
            className={`flex flex-col items-center gap-0.5 flex-1 transition-colors ${
              location.pathname === '/profile' ? 'text-brand-600' : 'text-gray-400'
            }`}
            onClick={() => setMenuOpen(false)}
          >
            {tabs[1].icon(location.pathname === '/profile')}
            <span className="text-[10px] font-medium">Profile</span>
          </Link>
        </div>
      </nav>
    </>
  );
}
