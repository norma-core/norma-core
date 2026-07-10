interface DeviceMetricPillProps {
  label: string;
  value: string;
  tone: string;
}

function DeviceMetricPill({ label, value, tone }: DeviceMetricPillProps) {
  return (
    <div className="min-w-0 rounded bg-surface-primary/70 px-2 py-1">
      <span className="mr-1 text-[10px] uppercase text-text-label">{label}</span>
      <span className={`font-mono text-xs font-semibold ${tone}`} title={value}>{value}</span>
    </div>
  );
}

export default DeviceMetricPill;
