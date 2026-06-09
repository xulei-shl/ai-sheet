/**
 * 等待动效组件
 * 在用户发送消息后、收到首个 token 前显示
 */

export function WaitingIndicator() {
  return (
    <div
      className="flex items-center gap-2"
      style={{ fontSize: 12, padding: '8px 0', color: 'var(--muted)' }}
      aria-label="AI 正在思考"
      aria-live="polite"
    >
      <div className="flex gap-1">
        <span className="typing-dot" />
        <span className="typing-dot" style={{ animationDelay: '0.2s' }} />
        <span className="typing-dot" style={{ animationDelay: '0.4s' }} />
      </div>
      <span>AI 正在思考</span>
    </div>
  );
}
