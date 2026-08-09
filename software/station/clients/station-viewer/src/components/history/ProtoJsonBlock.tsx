interface ProtoJsonBlockProps {
  title: string;
  value: unknown;
}

export default function ProtoJsonBlock({ title, value }: ProtoJsonBlockProps) {
  return (
    <div>
      <div className="mb-1 text-xs text-text-label">{title}</div>
      <div className="max-h-64 overflow-x-auto overflow-y-auto rounded bg-surface-primary p-2 font-mono text-xs text-accent-data">
        <pre>{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  );
}
