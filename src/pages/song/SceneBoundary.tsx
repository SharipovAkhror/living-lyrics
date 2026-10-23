import { Component, type ReactNode } from 'react';
import { acknowledgeSceneProbe } from '@/scene/probe';

interface Props {
  children: ReactNode;
  /** Save the position and record the error. Must not throw. */
  onCrash: (error: Error) => void;
}

interface State {
  failed: boolean;
  giveUp: boolean;
  epoch: number;
}

/**
 * A render error in the scene saves nothing by itself. This boundary records it,
 * asks the page to store the playhead, and mounts the scene again. The player
 * and the audio element stay; the page does not reload.
 */
export class SceneBoundary extends Component<Props, State> {
  state: State = { failed: false, giveUp: false, epoch: 0 };
  private recoveries = 0;

  static getDerivedStateFromError(error: Error): Partial<State> {
    void error;
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    acknowledgeSceneProbe();
    try {
      this.props.onCrash(error);
    } catch {
      /* recording must not block the remount */
    }
    // React may deliver the concurrent failure and the sync retry separately.
    // A render that still throws after the probe is acknowledged stops here.
    if (this.recoveries >= 3) {
      this.setState({ giveUp: true });
      return;
    }
    this.recoveries += 1;
    this.setState((s) => ({ failed: false, epoch: s.epoch + 1 }));
  }

  render() {
    if (this.state.giveUp || this.state.failed) return null;
    // display:contents keeps .scene positioned against the song, and the key remounts it.
    return (
      <div key={this.state.epoch} className="scene-boundary">
        {this.props.children}
      </div>
    );
  }
}
