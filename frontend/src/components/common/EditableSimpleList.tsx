export function EditableSimpleList({
  items,
  emptyMessage,
  onEdit,
  onRemove,
}: {
  items: string[];
  emptyMessage: string;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
}) {
  if (items.length === 0) {
    return <p className="empty-state">{emptyMessage}</p>;
  }

  return (
    <ul className="simple-list">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="editable-list-item">
          <span>{item}</span>
          <div className="row-actions">
            <button type="button" className="secondary-button" onClick={() => onEdit(index)}>
              Edit
            </button>
            <button type="button" className="danger-button" onClick={() => onRemove(index)}>
              Delete
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
