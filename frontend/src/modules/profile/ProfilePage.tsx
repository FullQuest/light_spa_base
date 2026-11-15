import { useAuth } from '../../auth/auth';
import './profile.css';

export function ProfilePage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <section className="profile-card">
      <h1>Профиль</h1>
      {([
        ['ID', user.id], ['Логин / email', user.email], ['Имя', user.full_name || '—'],
        ['Роль', user.role_name],
      ] as const).map(([label, value]) => (
        <div className="profile-row" key={label}>
          <span className="profile-row-label">{label}</span>
          <span className="profile-row-value">{value}</span>
        </div>
      ))}
    </section>
  );
}
