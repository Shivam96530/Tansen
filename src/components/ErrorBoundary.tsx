import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV !== "production") {
      console.error("ErrorBoundary caught:", error, errorInfo);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="grain flex min-h-screen w-full flex-col items-center justify-center bg-ink px-6 text-paper">
          <div className="relative z-10 mx-auto flex max-w-md flex-col items-center text-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-rose/10 text-rose ring-1 ring-rose/20">
              <AlertCircle size={24} />
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold text-paper sm:text-3xl">
              An unexpected pause
            </h2>
            <p className="mt-2 text-sm text-mist">
              Tansen encountered a playback or rendering issue. Your session can be safely restored.
            </p>
            <button
              onClick={this.handleReset}
              className="mt-6 flex items-center gap-2 rounded-xl bg-brass px-5 py-2.5 font-medium text-ink transition-transform hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(240,168,50,0.3)]"
            >
              <RotateCcw size={16} />
              Restore Session
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
