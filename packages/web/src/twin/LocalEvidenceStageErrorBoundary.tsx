import { Component, type ReactNode } from "react";

interface LocalEvidenceStageErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError: () => void;
  readonly resetKey: string;
}

interface LocalEvidenceStageErrorBoundaryState {
  readonly hasError: boolean;
}

/**
 * Contains failures from demand-loaded local evidence stages. The raw error is
 * deliberately not forwarded or rendered: local gateway URLs carry an
 * ephemeral token, so the parent can expose only fixed, sanitized review copy.
 */
export class LocalEvidenceStageErrorBoundary extends Component<
  LocalEvidenceStageErrorBoundaryProps,
  LocalEvidenceStageErrorBoundaryState
> {
  state: LocalEvidenceStageErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): LocalEvidenceStageErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(): void {
    this.props.onError();
  }

  override componentDidUpdate(previous: LocalEvidenceStageErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  override render(): ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}
