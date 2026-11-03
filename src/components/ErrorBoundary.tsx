import { Component, type ReactNode } from "react";
interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 flex items-center justify-center px-4" style={{ background: "var(--ocean-0)" }}>
          <div className="max-w-md text-center">
            <h1 className="t-display t-gold" style={{ fontSize: 32 }}>Something went wrong</h1>
            <p className="t-serif t-parch mt-4" style={{ fontSize: 14 }}>This screen could not load. Please try again.</p>
            <button onClick={() => window.location.reload()} className="btn-brass mt-6" style={{ padding: "10px 24px", fontSize: 11 }}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
