import { Component, type ReactNode } from "react";

interface MeshErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  readonly meshUrl: string;
}

interface MeshErrorBoundaryState {
  readonly hasError: boolean;
}

// Confines GLB load failures to the failing furniture instance.
export class MeshErrorBoundary extends Component<MeshErrorBoundaryProps, MeshErrorBoundaryState> {
  constructor(props: MeshErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MeshErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.warn(`VenViewer: GLB load failed for ${this.props.meshUrl}, falling back to procedural mesh.`, error);
  }

  override componentDidUpdate(prevProps: MeshErrorBoundaryProps): void {
    // Reset on URL change so a corrected meshUrl is retried.
    if (prevProps.meshUrl !== this.props.meshUrl && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}
