export default function Panel({ title, actions, className = "", children }) {
  return (
    <div className={`panel ${className}`}>
      {(title || actions) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {actions && <div className="panel-actions">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Empty({ children = "No data for this day yet." }) {
  return <p className="empty">{children}</p>;
}
