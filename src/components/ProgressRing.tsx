/**
 * Anillo circular de progreso. En modo determinado (`progress` 0–1) muestra
 * cuánto falta del ciclo actual. En modo indeterminado (`pulse`) — usado en
 * modo Libre, que no tiene una duración fija — hace un pulso suave para
 * indicar "grabando" sin prometer un total.
 */
export default function ProgressRing({
  progress,
  pulse = false,
  size = 220,
  strokeWidth = 8,
  className,
}: {
  progress: number;
  pulse?: boolean;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  const offset = circumference * (1 - clamped);

  return (
    <svg
      className={`progress-ring${pulse ? ' progress-ring-pulse' : ''}${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
    >
      <circle
        className="progress-ring-track"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
      />
      <circle
        className="progress-ring-fill"
        cx={size / 2}
        cy={size / 2}
        r={radius}
        strokeWidth={strokeWidth}
        fill="none"
        strokeDasharray={circumference}
        strokeDashoffset={pulse ? 0 : offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}
