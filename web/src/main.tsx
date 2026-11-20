import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AuthProvider, useAuth } from './auth-context';
import { Login } from './Login';
import './index.css';

// Gate : tant que la session n'est pas vérifiée -> écran de chargement ;
// sans session -> Login ; sinon -> application.
function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 text-slate-500">
        Chargement…
      </div>
    );
  }
  return user ? <App /> : <Login />;
}

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <Gate />
  </AuthProvider>
);
