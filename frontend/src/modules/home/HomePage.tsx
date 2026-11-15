import { useAuth } from '../../auth/auth';

export function HomePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1>Главная</h1>
      <p>Привет, {user?.full_name || user?.email}!</p>
    </section>
  );
}
