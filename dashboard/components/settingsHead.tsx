// The heading at the top of each Settings section.
export function SectionHead({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="set-head">
      <h2 className="set-head-t">{title}</h2>
      <span className="sub">{sub}</span>
    </div>
  );
}
