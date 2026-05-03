export function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <header className="section-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </header>
  );
}
