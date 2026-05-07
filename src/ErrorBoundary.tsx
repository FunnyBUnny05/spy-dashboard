import { Component, ReactNode } from 'react';
export class ErrorBoundary extends Component<{children:ReactNode},{error:string|null}> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e.message + '\n' + e.stack }; }
  render() {
    if (this.state.error) return (
      <pre style={{color:'red',padding:20,whiteSpace:'pre-wrap',fontFamily:'monospace',fontSize:12}}>
        {this.state.error}
      </pre>
    );
    return this.props.children;
  }
}
