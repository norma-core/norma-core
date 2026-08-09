import { Component } from 'react';
import type { ReactNode } from 'react';

interface DeviceErrorBoundaryProps {
  label: string;
  resetKey?: unknown;
  children: ReactNode;
}

interface DeviceErrorBoundaryState {
  error: Error | null;
}

export default class DeviceErrorBoundary extends Component<
  DeviceErrorBoundaryProps,
  DeviceErrorBoundaryState
> {
  state: DeviceErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DeviceErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(previousProps: DeviceErrorBoundaryProps) {
    if (
      this.state.error
      && !Object.is(previousProps.resetKey, this.props.resetKey)
    ) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-20 items-center justify-center rounded-lg border border-accent-critical bg-surface-primary/40 p-4 text-center text-accent-critical">
          Failed to render {this.props.label}: {this.state.error.message}
        </div>
      );
    }

    return this.props.children;
  }
}
