export function ProgressBar({
  value,
  max,
  label,
}: Readonly<{
  value: number;
  max: number;
  label: string;
}>) {
  const percentage = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="progress-bar" aria-label={label}>
      <span className="progress-bar-track" aria-hidden="true">
        <span className="progress-bar-value" style={{ width: `${percentage}%` }} />
      </span>
      <span>
        {value} de {max} completados
      </span>
    </div>
  );
}
