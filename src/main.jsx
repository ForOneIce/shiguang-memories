import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class AppBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <main className="fatal-error"><h1>这一页暂时没有打开</h1><p>已保存的记录没有被清空。请保留原备份，刷新页面后再试。</p><button onClick={() => window.location.reload()}>重新打开</button></main>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(<AppBoundary><App /></AppBoundary>);
